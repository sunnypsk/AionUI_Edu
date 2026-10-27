"""Release gates: image identity, credential isolation and interrupted-update recovery."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deployUnraid.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)
container_spec = importlib.util.spec_from_file_location("container_check", Path(__file__).with_name("checkContainer.py"))
container_check = importlib.util.module_from_spec(container_spec)
container_spec.loader.exec_module(container_check)


def image():
    return {"Id": "sha256:" + "b" * 64, "Os": "linux", "Architecture": "amd64",
            "RepoDigests": [deploy.IMAGE + "@sha256:" + "c" * 64],
            "Config": {"Labels": {"org.opencontainers.image.source": "https://github.com/sunnypsk/AionUI_Edu",
                                  "org.opencontainers.image.revision": "a" * 40,
                                  "uk.littlething.aionui-edu.release-sequence": "12.1"}}}


class ContainerSmoke(unittest.TestCase):
    def test_apparmor_hosts_require_the_named_sandbox_profile(self):
        result = subprocess.CompletedProcess([], 0, '["name=apparmor", "name=seccomp,profile=builtin"]', "")
        with patch.object(container_check, "docker", return_value=result):
            self.assertEqual(container_check.apparmor_options(), ["--security-opt", "apparmor=aionui-sandbox"])

    def test_hosts_without_apparmor_do_not_receive_an_unsupported_option(self):
        result = subprocess.CompletedProcess([], 0, '["name=seccomp,profile=builtin", "name=cgroupns"]', "")
        with patch.object(container_check, "docker", return_value=result):
            self.assertEqual(container_check.apparmor_options(), [])

    def test_security_detection_failure_does_not_silently_disable_apparmor(self):
        with patch.object(container_check, "docker", side_effect=RuntimeError("daemon unavailable")):
            with self.assertRaisesRegex(RuntimeError, "daemon unavailable"):
                container_check.apparmor_options()

    def test_failed_commands_preserve_actionable_stderr(self):
        result = subprocess.CompletedProcess([], 1, "", "chrome_crashpad_handler: --database is required")
        with patch.object(container_check.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "database is required"):
                container_check.docker("exec", "fixture-app", "browser")

    def test_diagnostics_redact_account_details_and_proxy_userinfo(self):
        result = subprocess.CompletedProcess([], 1, "Browser failed\npassword: fixture-value\n",
                                             "Authorization: Bearer fixture-value\nsocks5://fixture-user:fixture-pass@192.0.2.20:1080")
        with patch.object(container_check.subprocess, "run", return_value=result):
            with self.assertRaises(RuntimeError) as failure:
                container_check.docker("exec", "fixture-app", "browser", "private-argument")
        message = str(failure.exception)
        self.assertIn("Browser failed", message)
        self.assertIn("socks5://[REDACTED]@192.0.2.20:1080", message)
        self.assertNotIn("fixture-value", message)
        self.assertNotIn("fixture-user", message)
        self.assertNotIn("private-argument", message)

    def test_browser_probes_use_the_application_user_and_its_owned_home(self):
        with patch.object(container_check, "docker") as command:
            container_check.app_exec("fixture-app", "bun", "browser.ts",
                                     env={"AIONUI_BUNDLED_CODEX": "/app/node_modules/.bin/codex"})
        command.assert_called_once_with("exec", "--user", "99:100", "-e", "HOME=/data/home",
                                        "-e", "AIONUI_BUNDLED_CODEX=/app/node_modules/.bin/codex",
                                        "fixture-app", "bun", "browser.ts", check=True)

    def test_negative_network_probes_preserve_their_exit_status(self):
        result = subprocess.CompletedProcess([], 7, "", "connection refused")
        with patch.object(container_check.subprocess, "run", return_value=result):
            self.assertIs(container_check.docker("exec", "fixture-app", "curl", check=False), result)


class DockerCommands(unittest.TestCase):
    def test_slow_registry_downloads_can_finish_before_the_pull_deadline(self):
        def slow_download(command, **options):
            if options["timeout"] < 600:
                raise subprocess.TimeoutExpired(command, options["timeout"])
            return subprocess.CompletedProcess(command, 0, "Download complete\n", "")

        with patch.object(deploy.subprocess, "run", side_effect=slow_download):
            self.assertEqual(deploy.docker("pull", deploy.IMAGE + ":stable"), "Download complete")

    def test_container_operations_keep_the_five_minute_deadline(self):
        result = subprocess.CompletedProcess([], 0, "[]", "")
        with patch.object(deploy.subprocess, "run", return_value=result) as command:
            deploy.docker("inspect", "fixture-app")
        self.assertEqual(command.call_args.kwargs["timeout"], 300)

    def test_failed_pulls_do_not_expose_private_docker_diagnostics(self):
        result = subprocess.CompletedProcess([], 1, "", "socks5://fixture-user:fixture-password@192.0.2.20:1080")
        with patch.object(deploy.subprocess, "run", return_value=result):
            with self.assertRaisesRegex(RuntimeError, "^Docker operation failed: pull$"):
                deploy.docker("pull", deploy.IMAGE + ":stable")


class BrowserProfileLocks(unittest.TestCase):
    def setUp(self):
        self.original_host_check = deploy.browser_profile_in_use
        idle = patch.object(deploy, "browser_profile_in_use", return_value=False)
        self.host_check = idle.start()
        self.addCleanup(idle.stop)
        self.folder = tempfile.TemporaryDirectory()
        self.base = Path(self.folder.name)
        self.subject = deploy.Deployment(self.base, self.base / "template")
        self.subject.settings = {"puid": os.getuid(), "pgid": os.getgid()}
        self.profile = self.subject.data / "browser-profiles" / ("a" * 64)
        self.profile.mkdir(parents=True)
        (self.profile / "Cookies").write_bytes(b"preserved login fixture")
        for name, target in [("SingletonLock", "previous-host-2984"),
                             ("SingletonSocket", "/tmp/previous-browser/socket"),
                             ("SingletonCookie", "12345")]:
            (self.profile / name).symlink_to(target)
        self.backup = self.base / "backups" / "release"
        deploy.copy_data(self.subject.data, self.backup / "data")

    def tearDown(self):
        self.folder.cleanup()

    def test_releases_only_snapshotted_symlinks_and_preserves_login(self):
        with patch.object(deploy, "inventory", return_value={}):
            self.subject.release_browser_locks(self.backup)
        self.assertFalse((self.profile / "SingletonLock").is_symlink())
        self.assertEqual((self.profile / "Cookies").read_bytes(), b"preserved login fixture")
        self.assertTrue((self.backup / "data/browser-profiles" / ("a" * 64) / "SingletonLock").is_symlink())

    def test_keeps_locks_when_another_container_owns_the_mount(self):
        running = {"State": {"Running": True}, "Mounts": [{"Source": str(self.subject.data)}]}
        with patch.object(deploy, "inventory", return_value={"active": running}):
            with self.assertRaisesRegex(RuntimeError, "running container"):
                self.subject.release_browser_locks(self.backup)
        self.assertTrue((self.profile / "SingletonLock").is_symlink())

    def test_requires_the_exact_lock_snapshot_before_releasing_any_lock(self):
        (self.profile / "SingletonCookie").unlink()
        (self.profile / "SingletonCookie").symlink_to("changed")
        with self.assertRaisesRegex(RuntimeError, "snapshot is missing or changed"):
            self.subject.release_browser_locks(self.backup)
        self.assertTrue((self.profile / "SingletonLock").is_symlink())

    def test_leaves_unrecognized_regular_lock_files_untouched(self):
        (self.profile / "SingletonLock").unlink()
        (self.profile / "SingletonLock").write_text("unrecognized")
        with self.assertRaisesRegex(RuntimeError, "Unrecognized browser lock"):
            self.subject.release_browser_locks(self.backup)
        self.assertEqual((self.profile / "SingletonLock").read_text(), "unrecognized")

    def test_refuses_a_symlinked_profile(self):
        linked = self.profile.parent / ("b" * 64)
        linked.symlink_to(self.profile, target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, "owned directory"):
            self.subject.release_browser_locks(self.backup)
        self.assertTrue((self.profile / "SingletonLock").is_symlink())

    def test_keeps_valid_locks_used_by_a_host_process(self):
        self.host_check.return_value = True
        with patch.object(deploy, "inventory", return_value={}):
            with self.assertRaisesRegex(RuntimeError, "host process"):
                self.subject.release_browser_locks(self.backup)
        self.assertTrue((self.profile / "SingletonLock").is_symlink())

    def test_host_scan_recognizes_both_profile_argument_forms(self):
        proc = self.base / "proc"
        process = proc / "123"
        process.mkdir(parents=True)
        for args in (["chromium", "--user-data-dir=" + str(self.profile)],
                     ["chromium", "--user-data-dir", str(self.profile)]):
            (process / "cmdline").write_bytes(b"\0".join(os.fsencode(arg) for arg in args))
            self.assertTrue(self.original_host_check(self.profile.parent, proc))
        (process / "cmdline").write_bytes(b"chromium\0--user-data-dir=/unrelated/profile\0")
        self.assertFalse(self.original_host_check(self.profile.parent, proc))



class Release(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.base = Path(self.folder.name)
        self.data = self.base / "data"
        self.data.mkdir()
        self.control = self.base / "deployment"
        deploy.atomic(self.control / "settings.json", {"bindAddress": "192.0.2.10", "port": 25808, "puid": 99, "pgid": 100})
        deploy.atomic(self.data / "network-proxy.json", {"enabled": True, "proxyUrl": "socks5://fixture:synthetic@192.0.2.20:1080"})
        self.template = self.base / "template.xml"
        self.subject = deploy.Deployment(self.base, self.template)

    def tearDown(self):
        self.folder.cleanup()

    def old(self):
        return {"Id": "old-id", "Image": "old-image", "Name": "/aionui-edu", "State": {"Running": True},
                "Config": {"Labels": {"uk.littlething.aionui-edu.managed": "1"}},
                "Mounts": [{"Type": "bind", "Source": str(self.data), "Destination": "/data"}],
                "HostConfig": {"NetworkMode": "bridge", "Privileged": False,
                               "PortBindings": {"25808/tcp": [{"HostIp": "192.0.2.10", "HostPort": "25808"}]}}}

    def successful_docker(self, *args):
        if args[:2] == ("image", "inspect"):
            return json.dumps([image()])
        if args[0] == "inspect":
            return json.dumps([self.old()])
        return "new-id" if args[0] == "run" else ""

    def test_pins_the_verified_registry_digest(self):
        self.assertEqual(deploy.validate_image(image())["image"], deploy.IMAGE + "@sha256:" + "c" * 64)

    def test_rejects_wrong_source_architecture_sequence_or_missing_digest(self):
        for key, value in [("Architecture", "arm64"), ("RepoDigests", [])]:
            candidate = image()
            candidate[key] = value
            with self.assertRaises(ValueError):
                deploy.validate_image(candidate)
        for key, value in [("org.opencontainers.image.source", "https://untrusted.invalid"),
                           ("uk.littlething.aionui-edu.release-sequence", "0.0")]:
            candidate = image()
            candidate["Config"]["Labels"][key] = value
            with self.assertRaises(ValueError):
                deploy.validate_image(candidate)

    def test_requires_private_proxy_configuration_before_startup(self):
        self.subject.validate_settings()
        (self.data / "network-proxy.json").chmod(0o644)
        with self.assertRaisesRegex(ValueError, "owner-only"):
            self.subject.validate_settings()

    def test_legacy_settings_keep_the_default_task_limit(self):
        self.subject.validate_settings()
        args = self.subject.create_args("pinned-image")
        self.assertEqual(args[args.index("--pids-limit") + 1], str(deploy.DEFAULT_PIDS_LIMIT))
        compose = Path(__file__).with_name("compose.nas.yaml").read_text()
        self.assertIn("${AIONUI_PIDS_LIMIT:-" + str(deploy.DEFAULT_PIDS_LIMIT) + "}", compose)

    def test_optional_task_limit_is_bounded_and_applied_to_candidates_and_template(self):
        for limit in (512, 768, 1024):
            self.subject.settings["pidsLimit"] = limit
            self.subject.validate_settings()
            for probe in (None, self.control / "probe"):
                args = self.subject.create_args("pinned-image", "candidate", probe)
                self.assertEqual(args[args.index("--pids-limit") + 1], str(limit))
            self.subject.write_template(deploy.validate_image(image()))
            self.assertIn("--pids-limit=" + str(limit), ET.fromstring(self.template.read_text()).findtext("ExtraParams"))
        for invalid in (511, 1025, True, "768", None, 768.5):
            self.subject.settings["pidsLimit"] = invalid
            with self.assertRaisesRegex(ValueError, "pidsLimit"):
                self.subject.validate_settings()

    def test_rejects_disabled_or_dns_dependent_proxy_settings(self):
        for value in [{"enabled": False}, {"enabled": True, "proxyUrl": "socks5://proxy.example:1080"}]:
            deploy.atomic(self.data / "network-proxy.json", value)
            with self.assertRaises(ValueError):
                self.subject.validate_settings()

    def test_rejects_symlinked_data_directories(self):
        self.subject.data = self.base / "linked"
        self.subject.data.symlink_to(self.data)
        with self.assertRaisesRegex(ValueError, "symlinks"):
            self.subject.validate_settings()

    def test_candidates_have_an_isolated_data_mount_and_no_secrets_in_arguments(self):
        probe = self.control / "probe"
        args = self.subject.create_args("pinned-image", "probe-name", probe)
        self.assertIn(str(probe) + ":/data:rw", args)
        self.assertNotIn(str(self.data) + ":/data:rw", args)
        self.assertNotIn("synthetic", " ".join(args))

    def test_browser_sandbox_policy_is_pinned_and_outside_the_agent_data_mount(self):
        args = self.subject.create_args("pinned-image")
        policy = self.control / "browser-seccomp.json"
        self.assertIn("seccomp=" + str(policy), args)
        self.assertEqual(deploy.hashlib.sha256(json.dumps(json.loads(policy.read_text()), sort_keys=True, separators=(",", ":")).encode()).hexdigest(), deploy.BROWSER_SECCOMP_SHA)
        self.assertNotIn("--privileged", args)

    def test_unraid_recreation_preserves_the_explicit_lan_bind_and_restart_policy(self):
        self.subject.write_template(deploy.validate_image(image()))
        tree = ET.fromstring(self.template.read_text())
        self.assertIn("--publish=192.0.2.10:25808:25808", tree.findtext("ExtraParams"))
        self.assertIn("--restart=unless-stopped", tree.findtext("ExtraParams"))
        self.assertFalse(any(node.get("Type") == "Port" for node in tree.findall("Config")))

    def test_refuses_custom_mounts_including_the_docker_socket(self):
        old = self.old()
        old["Mounts"].append({"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"})
        with self.assertRaisesRegex(ValueError, "reviewed deployment"):
            self.subject.validate_existing(old)

    def test_defers_updates_while_a_codex_session_process_exists(self):
        def process_list(*args):
            if "pid" not in args[-1].split(","):
                raise RuntimeError("Couldn't find PID field in ps output")
            return "PID COMMAND\n42 /app/codex app-server\n"
        with patch.object(deploy, "docker", side_effect=process_list):
            with self.assertRaisesRegex(RuntimeError, "still running"):
                self.subject.validate_existing(self.old())

    def test_the_account_status_process_does_not_count_as_a_conversation(self):
        with patch.object(deploy, "docker", return_value='PID COMMAND\n42 /app/codex app-server --listen stdio:// -c cli_auth_credentials_store="file"\n'):
            self.subject.validate_existing(self.old())

    def test_defers_updates_while_the_teacher_browser_is_open(self):
        with patch.object(deploy, "docker", return_value='PID COMMAND\n42 /usr/lib/chromium/chromium --user-data-dir=/data/browser-profiles/fixture\n'):
            with self.assertRaisesRegex(RuntimeError, "browser is still running"):
                self.subject.validate_existing(self.old())

    def test_other_service_changes_still_require_rollback(self):
        unrelated_before = {"Id": "other-old-id", "Image": "other-old-image", "State": {"Running": True}}
        unrelated_after = {"Id": "other-new-id", "Image": "other-new-image", "State": {"Running": True}}
        inventories = [{deploy.NAME: self.old(), "other-service": unrelated_before},
                       {deploy.NAME: {"Id": "new-id"}, "other-service": unrelated_after}]

        with patch.object(deploy, "inventory", side_effect=inventories), patch.object(deploy, "docker", side_effect=self.successful_docker) as docker_command, patch.object(deploy, "copy_data"), patch.object(self.subject, "probe"), patch.object(self.subject, "healthy"), patch.object(self.subject, "validate_existing"), patch.object(self.subject, "restore") as restore, patch("builtins.print"):
            with self.assertRaisesRegex(RuntimeError, "Another service changed during deployment"):
                self.subject.apply()

        restore.assert_called_once()
        self.assertFalse((self.control / "current.json").exists())
        self.assertFalse(any(value in {"other-service", "other-old-id", "other-new-id"}
                             for call in docker_command.call_args_list for value in call.args))

    def test_failed_application_health_still_requires_rollback(self):
        before = {deploy.NAME: self.old(), "other-service": {"Id": "other-id"}}
        with patch.object(deploy, "inventory", return_value=before), patch.object(deploy, "docker", side_effect=self.successful_docker), patch.object(deploy, "copy_data"), patch.object(self.subject, "probe"), patch.object(self.subject, "healthy", side_effect=RuntimeError("Application health failed")), patch.object(self.subject, "validate_existing"), patch.object(self.subject, "restore") as restore:
            with self.assertRaisesRegex(RuntimeError, "Application health failed"):
                self.subject.apply()
        restore.assert_called_once()
        self.assertFalse((self.control / "current.json").exists())

    def test_failed_switch_restores_snapshot_and_preserves_failed_data_for_review(self):
        backup = self.base / "backups" / "release"
        (backup / "data").mkdir(parents=True)
        (backup / "data" / "chat.txt").write_text("original chat")
        (self.data / "chat.txt").write_text("failed migration")
        new = self.old()
        new.update(Id="new-id", Image="new-image")
        journal = {"oldId": "old-id", "imageId": "new-image", "backup": str(backup), "snapshotComplete": True, "template": "original-template"}
        deploy.atomic(self.control / "journal.json", journal)
        with patch.object(deploy, "inventory", return_value={deploy.NAME: new}), patch.object(deploy, "docker", return_value=json.dumps([self.old()])) as command:
            self.subject.restore(journal)
        self.assertEqual((self.data / "chat.txt").read_text(), "original chat")
        self.assertEqual((backup / "failed-data" / "chat.txt").read_text(), "failed migration")
        self.assertIn(unittest.mock.call("start", "old-id"), command.call_args_list)

    @unittest.skipUnless(os.geteuid() == 0, "Ownership changes are tested as root inside the Linux image")
    def test_restored_private_files_remain_readable_by_the_application_user(self):
        self.base.chmod(0o755)
        source = self.data / "owned"
        source.mkdir(mode=0o700)
        document = source / "document.txt"
        document.write_text("saved document")
        document.chmod(0o600)
        outside = self.base / "outside.txt"
        outside.write_text("outside ownership is unchanged")
        link = source / "link"
        link.symlink_to(outside)
        for path in [source, document, link]:
            os.chown(path, 99, 100, follow_symlinks=False)
        backup, restored = self.base / "snapshot", self.base / "restored"
        deploy.copy_data(source, backup)
        deploy.copy_data(backup, restored)
        result = subprocess.run([sys.executable, "-c", "import pathlib,sys; print(pathlib.Path(sys.argv[1]).read_text())", str(restored / "document.txt")],
                                user=99, group=100, capture_output=True, text=True, check=True)
        self.assertEqual(result.stdout.strip(), "saved document")
        self.assertEqual((restored / "link").lstat().st_uid, 99)
        self.assertEqual(outside.stat().st_uid, 0)

    def test_recovery_does_not_touch_an_unknown_container(self):
        unknown = self.old()
        unknown.update(Id="unrelated", Image="unrelated-image")
        with patch.object(deploy, "inventory", return_value={deploy.NAME: unknown}), patch.object(deploy, "docker") as command:
            with self.assertRaisesRegex(RuntimeError, "Unexpected container"):
                self.subject.restore({"oldId": "old-id", "imageId": "new-image"})
        command.assert_not_called()

    def test_rejected_proxy_credentials_do_not_replace_saved_configuration(self):
        previous = (self.data / "network-proxy.json").read_text()
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.side_effect = [bytes([5, 2]), bytes([1, 1])]
        with patch.object(deploy, "BASE", self.base), patch.object(deploy.getpass, "getpass", side_effect=["fixture-user", "fixture-password"]), patch.object(deploy.socket, "getaddrinfo", return_value=[(0, 0, 0, "", ("192.0.2.20", 1080))]), patch.object(deploy.socket, "create_connection", return_value=connection):
            with self.assertRaisesRegex(RuntimeError, "nothing was saved"):
                deploy.configure_proxy("proxy.example:1080")
        self.assertEqual((self.data / "network-proxy.json").read_text(), previous)

    def test_proxy_setup_resolves_on_the_host_and_handles_fragmented_auth_replies(self):
        connection = MagicMock()
        connection.__enter__.return_value = connection
        connection.recv.side_effect = [bytes([5]), bytes([2]), bytes([1]), bytes([0])]
        with patch.object(deploy, "BASE", self.base), patch.object(deploy.getpass, "getpass", side_effect=["fixture@user", "fixture%password"]), patch.object(deploy.socket, "getaddrinfo", return_value=[(0, 0, 0, "", ("192.0.2.20", 1080))]), patch.object(deploy.socket, "create_connection", return_value=connection), patch.object(deploy.os, "chown"), patch("builtins.print") as output:
            deploy.configure_proxy("proxy.example:1080")
        value = deploy.read(self.data / "network-proxy.json")
        self.assertTrue(value["enabled"])
        self.assertIn("@192.0.2.20:1080", value["proxyUrl"])
        self.assertNotIn("fixture", str(output.call_args_list))


if __name__ == "__main__":
    unittest.main()
