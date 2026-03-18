#!/bin/sh

set -eu

pnpm exec oxlint --type-aware --type-check src scripts convex infra/*.ts *.ts
