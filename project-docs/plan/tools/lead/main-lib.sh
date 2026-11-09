#!/bin/bash
# land.sh와 main-merge.sh가 source하는 공용 함수. main에 쓰는 길은 이 둘뿐이다.
# 부르는 쪽이 MAIN(main checkout 경로)을 정해 둔다. 함수는 branch worktree 안에서 부른다.

step() { echo "$(date +%H:%M:%S) $*"; }

# lock file은 모든 worktree가 같이 보는 git common dir에 둔다.
common_dir() { git -C "$MAIN" rev-parse --path-format=absolute --git-common-dir; }

# main에 쓰는 것(ff, 사람의 직접 commit)은 이 lock 하나로 줄 세운다. 그래서 lock을 쥔 동안 main은 움직이지 않는다.
main_lock_file() { echo "$(common_dir)/lophn-main.lock"; }

# main checkout이 main이 아니면 ff가 엉뚱한 branch를 움직인다.
require_main_checkout() {
  [ "$(git -C "$MAIN" branch --show-current)" = main ] || { echo "STOP: main checkout($MAIN)이 main branch가 아니다"; return 1; }; }

# rebase로 main의 의존성 변경을 받으면 node_modules가 낡는다(wireframes smoke가 그것으로 멈췄다).
deps() { git diff --quiet "$1" "$2" -- package-lock.json && return 0
  step "package-lock이 바뀌어 npm ci"
  out=$(npm ci 2>&1 9>&-) || { echo "$out" | tail -10; echo "STOP: npm ci failed"; return 1; }; }

# 판 줄은 land가 정하므로 branch가 옛 습관대로 고쳐 두면 모든 branch가 거기서 충돌한다.
# 충돌이 package.json의 판 줄뿐이면 세 판을 main의 판으로 맞춰 다시 3-way 병합한다. 그 밖의 충돌은 사람이 푼다.
resolve_version_conflict() {
  local t v; t=$(mktemp -d)
  v=$(git show :2:package.json | grep -m1 -oP '"version": "\K[^"]+') || return 1
  git show :2:package.json > "$t/ours" || return 1
  git show :1:package.json | sed -E "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$v\"/" > "$t/base" || return 1
  git show :3:package.json | sed -E "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$v\"/" > "$t/theirs" || return 1
  git merge-file -p "$t/ours" "$t/base" "$t/theirs" > "$t/out" || { rm -rf "$t"; return 1; }
  cp "$t/out" package.json; rm -rf "$t"; }

rebase_main() {
  git rebase main >/dev/null 2>&1 && return 0
  while [ "$(git diff --name-only --diff-filter=U)" = package.json ] && resolve_version_conflict; do
    git add package.json
    GIT_EDITOR=true git rebase --continue >/dev/null 2>&1 && return 0
  done
  echo "STOP: rebase conflict"; git status --short | head; return 1; }

# branch는 판을 고치지 않는다. main에 올리는 순간 여기서 정한다: packages/를 바꿨으면 main 판의 PATCH+1, 아니면 main 판 그대로.
# branch가 더한 change-log 항목의 version과 폴더도 그 판으로 맞춰 "Release" commit 하나로 남긴다.
assign_version() {
  local branch cur new f dest mm
  branch=$(git branch --show-current)
  cur=$(git show main:package.json | grep -m1 -oP '"version": "\K[^"]+') || { echo "STOP: main의 판을 못 읽음"; return 1; }
  new=$cur
  if git diff --name-only main...HEAD -- packages/ | grep -q .; then
    new=${cur%.*}.$(( ${cur##*.} + 1 ))
  fi
  sed -i -E "0,/\"version\": \"[^\"]*\"/s//\"version\": \"$new\"/" package.json
  mm=${new%.*}
  for f in $(git diff --diff-filter=A --name-only main...HEAD -- project-docs/products/change-log/ | grep '\.yaml$'); do
    dest=project-docs/products/change-log/$mm/$(basename "$f")
    [ "$f" = "$dest" ] || { mkdir -p "$(dirname "$dest")"; git mv "$f" "$dest"; }
    sed -i -E "s/^version:.*/version: $new/" "$dest"
  done
  git add -A package.json project-docs/products/change-log
  git diff --cached --quiet && return 0
  git commit -q -m "Release $new: $branch" || return 1
  step "판 $new"; }

# main lock을 쥔 채 rebase를 마친 branch worktree에서 부른다. 판 정하기, check, main ff를 한 번에.
# 어디서 멈춰도 부르기 전 commit으로 되돌려, 고치고 다시 돌릴 때 옛 Release commit이 충돌하지 않게 한다.
# $1: 판을 정한 뒤 돌릴 check 명령(비면 건너뛴다). lock fd(9)는 자식에게 넘기지 않는다.
finish_on_main() {
  local pre out; pre=$(git rev-parse HEAD)
  stop() { git reset -q --hard "$pre"; echo "STOP: $1"; return 1; }
  assign_version || stop "판 정하기 실패" || return 1
  if [ -n "$1" ]; then
    out=$(eval "$1" 2>&1 9>&-) || { echo "$out" | tail -30; stop "check failed" || return 1; }
  fi
  # 판을 바꾼 뒤라 records(판과 항목 쌍)는 check를 건너뛰어도 꼭 본다. packages/를 바꿨는데 항목이 없으면 여기서 걸린다.
  out=$(node tools/records.ts check 2>&1 9>&-) || { echo "$out" | head -10; stop "records check 실패(packages/를 바꿨으면 change-log 항목이 있어야 한다)" || return 1; }
  git -C "$MAIN" merge --ff-only -q "$(git branch --show-current)" || stop "main ff failed(main checkout에 겹치는 고친 file이 있다)" || return 1; }
