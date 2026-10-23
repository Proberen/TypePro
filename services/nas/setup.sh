#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ -e .env ]; then
  echo '.env 已存在，保留原配置。'
  exit 0
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo '需要 openssl 生成随机令牌；也可复制 .env.example 并自行填入随机令牌。' >&2
  exit 1
fi
umask 077
task_token=$(openssl rand -hex 32)
task_env_tmp=$(mktemp .env.setup.XXXXXX)
trap 'rm -f "$task_env_tmp"' EXIT HUP INT TERM
sed "s/^TYPEPRO_TOKEN=$/TYPEPRO_TOKEN=$task_token/" .env.example > "$task_env_tmp"
# 硬链接不会覆盖另一个进程刚创建的 .env。
if ln "$task_env_tmp" .env 2>/dev/null; then
  echo '已生成 .env。域名部署请先填写 TYPEPRO_PUBLIC_URL，再在 NAS 上启动容器。'
else
  echo '.env 已存在，保留原配置。'
fi
