# M2 evidence: questionnaire and version history

**Claims:** answers are saved one at a time and the questionnaire resumes
where the user stopped. Questions can be skipped. Answers can be edited and
old answers are kept. Every save of the story text is a new version and an
old version can be restored.

## Automated tests

| Test | File | What it proves |
|---|---|---|
| Vitest, 10 tests | `tests/integration/questionnaire.test.ts` | First answer is revision 1. An edit adds revision 2 and keeps revision 1. Saving the same answer adds nothing. A skip is recorded and can be answered later. Resume returns the first question that is not handled. Five edits at the same time get revisions 1 to 5. Another user cannot save or read answers. |
| Vitest, 7 tests | `tests/integration/story-versions.test.ts` | Versions are numbered 1, 2, 3. The story points at the newest. AI drafts and user edits share one history. Unchanged text adds no version. Restore creates a new version and deletes nothing. Five saves at the same time get five different numbers. Another user cannot add, list, read or restore. |
| Playwright, 2 tests | `tests/e2e/questionnaire.spec.ts` | In a real browser: answer, skip, answer, sign out, sign in, and the story opens at question 4 of 9. Editing answer 1 keeps the old answer under "Earlier answers". Two saves of story text and one restore give versions 1, 2, 3. |

Full output: [m2-test-output.log](m2-test-output.log)

## The concurrency tests can fail

I removed `.for("update")` from `lockStoryForUser` and ran the tests again:

```
× gives concurrent saves different version numbers
× gives each concurrent edit of one answer its own revision
error: duplicate key value violates unique constraint "story_versions_story_version_no_uq"
Tests  2 failed | 23 passed (25)
```

With the lock back, all 25 pass.

## Screenshots

- [m2-resume-at-question-4.png](m2-resume-at-question-4.png): after signing in again, the questionnaire opens at question 4. Question 2 shows "Skipped".
- [m2-answer-history.png](m2-answer-history.png): the edited answer with the earlier answer below it.
- [m2-version-history.png](m2-version-history.png): versions 1, 2 and 3 after a restore.
