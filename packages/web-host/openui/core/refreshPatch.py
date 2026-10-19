#!/usr/bin/env python3
"""Create a deterministic patch from an untouched pinned source and its working copy."""
import argparse
import difflib
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('baseline', type=Path)
    parser.add_argument('working', type=Path)
    options = parser.parse_args()
    ignored = {'target', '.git'}
    generated_manifest = 'crates/aionui-conversation/src/openui/manifest.json'

    def files(root):
        return {
            path.relative_to(root).as_posix(): path
            for path in root.rglob('*')
            if path.is_file()
            and not any(part in ignored for part in path.relative_to(root).parts)
            and path.relative_to(root).as_posix() != generated_manifest
        }

    original, current = files(options.baseline), files(options.working)
    chunks = []
    for name in sorted(original.keys() | current.keys()):
        before = original[name].read_bytes() if name in original else b''
        after = current[name].read_bytes() if name in current else b''
        if before == after:
            continue
        chunks.extend(difflib.unified_diff(
            before.decode('utf-8').splitlines(keepends=True),
            after.decode('utf-8').splitlines(keepends=True),
            fromfile='a/' + name if name in original else '/dev/null',
            tofile='b/' + name if name in current else '/dev/null',
        ))
    output = Path(__file__).with_name('openui.patch')
    output.write_text(''.join(chunks))
    print('Wrote', output, 'bytes:', output.stat().st_size)


if __name__ == '__main__':
    main()
