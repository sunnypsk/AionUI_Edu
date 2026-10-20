# WebUI development, verification and the explicitly requested push gate.
default:
    @just --list

install:
    bun install

start:
    bun run webui

webui:
    bun run webui

webui-remote:
    bun run webui:remote

webui-prod:
    bun run webui:prod

core-build:
    bun run openui:core:build

core-test:
    bun run openui:core:test

build:
    bun run build

package:
    bun run package

lint:
    bun run lint

lint-strict:
    bun run lint -- --quiet

lint-fix:
    bun run lint:fix

fmt:
    bun run format

fmt-check:
    bun run format:check

typecheck:
    bunx tsc --noEmit
    bunx tsc --noEmit -p packages/web-host/tsconfig.json

i18n-check:
    bun run i18n:types
    node scripts/check-i18n.js

test:
    bun run test

test-deploy:
    python3 -m unittest discover -s packages/web-host/docker -p 'test*.py'

test-e2e:
    bun run test:e2e

check: lint-strict fmt-check typecheck i18n-check

# Never publish or push implicitly. This recipe runs only when requested.
push *ARGS: check test test-deploy
    git push {{ ARGS }}
