#!/bin/sh

set -eu

# Type-aware Oxlint pass backed by tsgolint/typescript-go.
pnpm exec oxlint --type-aware --type-check src scripts convex infra/*.ts *.ts
