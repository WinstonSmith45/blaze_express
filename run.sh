#!/bin/bash
set -e
cd "$(dirname $(readlink -fm $0))"

# In Docker the token comes from the environment; otherwise read it from .env.
if [ -z "${WB_TOKEN}" ]; then
    WB_TOKEN=`cat .env | grep 'WB_TOKEN=' | sed 's/WB_TOKEN=//'`
fi
if [ -z "${WB_TOKEN}" ]; then
    echo "ERROR WB_TOKEN not provided in .env " >&2
    exit 1
fi

mkdir -p data

(
    flock -n 100 || exit 0
    export WB_TOKEN
    export OUTPUT_DIR=data/`date +%s`
    mkdir -p ${OUTPUT_DIR}
    python3 main.py 1>>${OUTPUT_DIR}/log 2>&1
) 100>data/run-lock



