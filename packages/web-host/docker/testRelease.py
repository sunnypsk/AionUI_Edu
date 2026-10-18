"""Release gates: image identity, credential isolation and interrupted-update recovery."""

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, patch

spec = importlib.util.spec_from_file_location("deploy", Path(__file__).with_name("deployUnraid.py"))
deploy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deploy)


def image():
    return {"Id": "sha256:" + "b" * 64, "Os": "linux", "Architecture": "amd64",
            "RepoDigests": [deploy.IMAGE + "@sha256:" + "c" * 64],
            "Config": {"Labels": {"org.opencontainers.image.source": "https://github.com/sunnypsk/AionUI_Edu",
                                  "org.opencontainers.image.revision": "a" * 40,
                                  "uk.littlething.aionui-edu.release-sequence": "12.1"}}}


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

    def test_refuses_custom_mounts_including_the_docker_socket(self):
        old = self.old()
        old["Mounts"].append({"Type": "bind", "Source": "/var/run/docker.sock", "Destination": "/var/run/docker.sock"})
        with self.assertRaisesRegex(ValueError, "reviewed deployment"):
            self.subject.validate_existing(old)

    def test_defers_updates_while_a_codex_session_process_exists(self):
        with patch.object(deploy, "docker", return_value="COMMAND\n/app/codex app-server\n"):
            with self.assertRaisesRegex(RuntimeError, "still running"):
                self.subject.validate_existing(self.old())

    def test_the_account_status_process_does_not_count_as_a_conversation(self):
        with patch.object(deploy, "docker", return_value='COMMAND\n/app/codex app-server --listen stdio:// -c cli_auth_credentials_store="file"\n'):
            self.subject.validate_existing(self.old())

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
