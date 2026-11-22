#!/usr/bin/env bash
# Copy this case's fixture into the run's working directory (the runner starts us there).
set -euo pipefail
cp -R "$(dirname "$0")/fixture/." .
