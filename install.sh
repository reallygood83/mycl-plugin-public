#!/usr/bin/env bash
set -euo pipefail

main() {
  local repo=https://github.com/reallygood83/mycl-plugin-public.git
  local install_dir="$HOME/.local/share/mycl-plugin"
  local skills_dir="$HOME/.agents/skills"
  local node_bin profile skill target link existing
  local -a skills=(mycl-router mycl-login-check mycl-gajeong-tongsin mycl-haengbal mycl-subject-comment)
  local -a mcp_args
  local login=true

  if [[ "${1:-}" == --no-login && "$#" == 1 ]]; then
    login=false
  elif [[ "$#" != 0 ]]; then
    printf '사용법: bash install.sh [--no-login]\n' >&2
    return 1
  fi

  for tool in git node npm codex; do
    command -v "$tool" >/dev/null || {
      printf '%s 명령을 찾을 수 없습니다. 먼저 설치한 뒤 다시 실행하세요.\n' "$tool" >&2
      return 1
    }
  done
  node_bin="$(command -v node)"
  if ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) < 20 ? 1 : 0)'; then
    printf 'Node.js 20 이상을 설치한 뒤 다시 실행하세요.\n' >&2
    return 1
  fi

  cd "$HOME"
  profile="$HOME/.mycl-profile"
  mcp_args=("$install_dir/node_modules/playwright/cli.js" mcp --browser chromium --user-data-dir "$profile")
  existing="$(codex mcp list --json | "$node_bin" -e '
    const servers = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
    const server = servers.find(({ name }) => name === "mycl-browser");
    if (server) process.stdout.write(JSON.stringify(server));
  ')"
  if [[ -n "$existing" ]]; then
    if ! printf '%s' "$existing" | "$node_bin" -e '
      const server = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
      const [command, ...args] = process.argv.slice(1);
      process.exit(server.enabled && server.transport?.command === command &&
        JSON.stringify(server.transport.args) === JSON.stringify(args) ? 0 : 1);
    ' "$node_bin" "${mcp_args[@]}"; then
      printf '기존 Codex mycl-browser 설정을 보존했습니다. 이름이 겹치거나 비활성화되어 있는지 확인하세요.\n' >&2
      return 1
    fi
  fi

  for skill in "${skills[@]}"; do
    target="$install_dir/skills/$skill"
    link="$skills_dir/$skill"
    if [[ -e "$link" || -L "$link" ]]; then
      if [[ ! -L "$link" || "$(readlink "$link")" != "$target" ]]; then
        printf '기존 스킬을 덮어쓸 수 없습니다: %s\n' "$link" >&2
        return 1
      fi
    fi
  done

  mkdir -p "$HOME/.local/share" "$skills_dir"
  if [[ -e "$install_dir" || -L "$install_dir" ]]; then
    if [[ -L "$install_dir" || ! -d "$install_dir/.git" ]] ||
      [[ "$(git -C "$install_dir" config --local --get remote.origin.url)" != "$repo" ]] ||
      [[ -n "$(git -C "$install_dir" status --porcelain)" ]]; then
      printf '기존 설치 폴더의 내용을 보존했습니다: %s\n' "$install_dir" >&2
      return 1
    fi
    git -C "$install_dir" fetch origin main
    git -C "$install_dir" merge --ff-only FETCH_HEAD
    if [[ "$(git -C "$install_dir" rev-parse HEAD)" != "$(git -C "$install_dir" rev-parse FETCH_HEAD)" ]]; then
      printf '설치 폴더에 별도의 커밋이 있습니다: %s\n' "$install_dir" >&2
      return 1
    fi
  else
    git clone --branch main --single-branch "$repo" "$install_dir"
  fi

  (
    cd "$install_dir"
    npm ci
    "$node_bin" node_modules/playwright/cli.js install chromium
  )
  if [[ -z "$existing" ]]; then
    codex mcp add mycl-browser -- "$node_bin" "${mcp_args[@]}"
  fi
  for skill in "${skills[@]}"; do
    link="$skills_dir/$skill"
    [[ -L "$link" ]] || ln -s "$install_dir/skills/$skill" "$link"
  done

  printf '설치 완료. Codex를 다시 열고 “마이클 로그인 확인해 줘”라고 입력하세요.\n'
  if "$login"; then
    printf '열리는 Chromium 창에서 티처빌 계정으로 직접 로그인하세요.\n'
    MYCL_PROFILE_DIR="$profile" "$node_bin" "$install_dir/scripts/login.mjs"
  fi
}

main "$@"
