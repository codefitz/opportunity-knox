#!/bin/sh
set -eu
BOARD_REPO=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
"$BOARD_REPO/board" start
