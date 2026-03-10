---
name: recap
description: Create or append a dated recap entry to the project's recap.md summarizing all work done since the last recap was written.
user-invokable: true
---

You are writing a session recap for the DockJock project. Follow these steps in order:

## 1. Find the last recap date

Read `c:/Users/ferre/Documents/DockJock/dockjock-phase2-fixed (1)/macro-tracker/recap.md` (it may not exist yet).
- If it exists, find the most recent `## [date]` heading to determine when the last recap was written.
- If it does not exist, the last recap date is "the beginning of the project".

## 2. Gather recent git activity

From the DockJock project root (`c:/Users/ferre/Documents/DockJock/dockjock-phase2-fixed (1)/macro-tracker/`), run:

```
git log --oneline --since="<last recap date>"
```

Also run `git diff HEAD --stat` and `git status` to capture any uncommitted changes.

## 3. Summarize the session

Write a new dated section covering everything done since the last recap, using what you know from the conversation context AND the git output. Include:

- **What was built or changed** — feature by feature, with the files touched
- **Bugs fixed** — root cause and fix
- **Architecture decisions** — any notable patterns introduced
- **What's still pending / next** — open work or TODOs

Keep it concise but specific. Write for a developer who wants to quickly catch up.

## 4. Append to recap.md

Append the new section to `c:/Users/ferre/Documents/DockJock/dockjock-phase2-fixed (1)/macro-tracker/recap.md`. Format:

```markdown
## [YYYY-MM-DD]

### What we did
- ...

### Bugs fixed
- ...

### Architecture / patterns
- ...

### Still pending
- ...

---
```

If the file does not exist yet, create it with a top-level header first:

```markdown
# DockJock — Session Recap Log

---
```

Then append the dated section.

## 5. Confirm

Tell the user the recap was written and give a one-paragraph plain-English summary of what was captured.
