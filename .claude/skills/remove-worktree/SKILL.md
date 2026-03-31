---
name: remove-worktree
description: 워크트리를 안전하게 제거하고 연결된 브랜치를 삭제합니다. 미완성 변경사항 경고 후 확인 받아 진행.
argument-hint: "[worktree-path-or-branch-name]"
disable-model-invocation: true
---

# Remove Worktree

워크트리를 제거하고 연결된 브랜치를 정리합니다.

## Current context

- Worktree list: `!git worktree list --porcelain`

## Instructions

Follow these phases exactly, in order. Do NOT skip phases.

---

### Phase 1: 워크트리 선택

1. `git worktree list --porcelain`을 실행하여 모든 워크트리 정보를 파싱한다.
   - 각 워크트리 항목은 `worktree <path>`, `HEAD <hash>`, `branch refs/heads/<name>` 형태로 출력된다.
   - **main worktree** (현재 체크아웃된 주 저장소)는 목록에서 제외한다.

2. **`$ARGUMENTS`가 제공된 경우**:
   - 워크트리 경로 또는 브랜치명으로 매칭되는 항목을 찾는다.
   - 경로의 마지막 부분(디렉터리명)으로도 매칭을 시도한다.
   - 매칭되는 항목이 없으면 사용 가능한 워크트리 목록을 보여주고 중단한다.

3. **`$ARGUMENTS`가 없는 경우**:
   - 워크트리가 하나도 없으면 "제거할 워크트리가 없습니다."라고 알리고 중단한다.
   - 워크트리가 하나면 자동 선택한다.
   - 워크트리가 여러 개면 번호와 함께 목록을 보여주고 `AskUserQuestion`으로 선택 받는다.
     ```
     제거할 워크트리를 선택하세요:
     1. feature/task-abc123  →  .worktrees/feature-task-abc123
     2. feature/task-xyz789  →  .worktrees/feature-task-xyz789
     ```

4. 선택된 워크트리의 **경로**와 **브랜치명**을 확정한다.

---

### Phase 2: 안전 검사

1. `git -C <worktree-path> status --porcelain`을 실행한다.

2. **변경사항이 없으면**: Phase 3으로 바로 진행한다.

3. **미커밋 변경사항이 있으면**:
   - 변경된 파일 목록을 보여준다.
   - `AskUserQuestion`으로 확인을 받는다:
     > "워크트리 `<branch-name>`에 미커밋 변경사항이 있습니다. 강제로 제거하면 이 변경사항은 영구적으로 삭제됩니다. 계속하시겠습니까? (yes/no)"
   - "no" 또는 거부하면 중단하고 변경사항을 커밋하거나 스태시할 것을 안내한다.
   - "yes"면 강제 제거 플래그(`--force`)를 사용하기로 표시하고 Phase 3으로 진행한다.

---

### Phase 3: 워크트리 제거

1. 워크트리를 제거한다:
   - 변경사항 없음: `git worktree remove <worktree-path>`
   - 강제 제거: `git worktree remove --force <worktree-path>`

2. 명령이 실패하면 에러 메시지를 출력하고 중단한다.

3. `git worktree list`를 실행하여 워크트리가 실제로 제거되었는지 확인한다.

---

### Phase 4: 브랜치 처리

1. 제거된 워크트리의 브랜치명(`<branch-name>`)을 사용한다.

2. `AskUserQuestion`으로 브랜치 삭제 여부를 확인한다:
   > "브랜치 `<branch-name>`도 삭제하시겠습니까? (yes/no)"

3. **"yes"인 경우**:
   - `git branch -D <branch-name>`을 실행한다.
   - 실패하면 에러를 보고하되 전체 작업은 성공으로 처리한다.

4. **"no"인 경우**: 브랜치를 그대로 유지한다.

---

### Phase 5: 완료 보고

다음 내용을 요약하여 보고한다:

- 제거된 워크트리 경로
- 삭제된 브랜치 (삭제한 경우) 또는 유지된 브랜치 (유지한 경우)
- 원격 브랜치가 존재할 경우 안내:
  > 원격 브랜치도 삭제하려면: `git push origin --delete <branch-name>`

---

## Important notes

- **주 워크트리(main worktree)는 절대 제거하지 않는다.**
- 워크트리 경로가 존재하지 않더라도 `git worktree prune` 후 재시도할 수 있음을 안내한다.
- 예상치 못한 상황이 발생하면 중단하고 상황을 설명한다. 추측으로 진행하지 않는다.
