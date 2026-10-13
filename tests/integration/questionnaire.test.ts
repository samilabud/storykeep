import { beforeEach, describe, expect, it } from "vitest";
import {
  getAnswerHistory,
  getCurrentAnswers,
  saveAnswer,
} from "@/questionnaire/data";
import { nextQuestionKey, QUESTIONS } from "@/questionnaire/questions";
import { createStory } from "@/stories/data";
import { createTestUser, resetDb } from "../helpers/db";

describe("questionnaire answers", () => {
  let alice: { id: string };
  let bob: { id: string };
  let storyId: string;

  beforeEach(async () => {
    await resetDb();
    alice = await createTestUser("alice@example.com");
    bob = await createTestUser("bob@example.com");
    storyId = (
      await createStory(alice.id, { title: "Grandpa Joe", kind: "life_story" })
    ).id;
  });

  it("saves a first answer as revision 1", async () => {
    const result = await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "  Joseph Ellis  ",
    });
    expect(result?.status).toBe("saved");
    expect(result?.answer).toMatchObject({
      revision: 1,
      answerText: "Joseph Ellis", // trimmed
      skipped: false,
    });
  });

  it("keeps the old answer when an answer is edited", async () => {
    await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "Joseph Ellis",
    });
    await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "Joseph 'Joe' Ellis",
    });

    const current = await getCurrentAnswers(alice.id, storyId);
    expect(current?.get("full_name")).toMatchObject({
      revision: 2,
      answerText: "Joseph 'Joe' Ellis",
    });

    const history = await getAnswerHistory(alice.id, storyId, "full_name");
    expect(history?.map((a) => [a.revision, a.answerText])).toEqual([
      [2, "Joseph 'Joe' Ellis"],
      [1, "Joseph Ellis"],
    ]);
  });

  it("does not add a revision when the same answer is saved again", async () => {
    const input = { questionKey: "work", answerText: "Carpenter" };
    await saveAnswer(alice.id, storyId, input);
    const again = await saveAnswer(alice.id, storyId, input);

    expect(again?.status).toBe("unchanged");
    expect(await getAnswerHistory(alice.id, storyId, "work")).toHaveLength(1);
  });

  it("records a skip, and lets the user answer it later", async () => {
    const skip = await saveAnswer(alice.id, storyId, {
      questionKey: "hard_times",
      skipped: true,
    });
    expect(skip?.answer).toMatchObject({ skipped: true, answerText: null });

    await saveAnswer(alice.id, storyId, {
      questionKey: "hard_times",
      answerText: "He lost the workshop in 1982.",
    });
    const current = await getCurrentAnswers(alice.id, storyId);
    expect(current?.get("hard_times")).toMatchObject({
      revision: 2,
      skipped: false,
    });
  });

  it("treats an empty answer as a skip", async () => {
    const result = await saveAnswer(alice.id, storyId, {
      questionKey: "legacy",
      answerText: "   ",
    });
    expect(result?.answer).toMatchObject({ skipped: true, answerText: null });
  });

  it("resumes at the first question that is not answered or skipped", async () => {
    const [q1, q2, q3, q4] = QUESTIONS;
    await saveAnswer(alice.id, storyId, { questionKey: q1.key, answerText: "a" });
    await saveAnswer(alice.id, storyId, { questionKey: q2.key, skipped: true });
    await saveAnswer(alice.id, storyId, { questionKey: q3.key, answerText: "c" });

    // A fresh read from the database, as if the user came back another day.
    const current = await getCurrentAnswers(alice.id, storyId);
    expect(nextQuestionKey(current!.keys())).toBe(q4.key);
  });

  it("reports no next question when all are handled", async () => {
    expect(nextQuestionKey(QUESTIONS.map((q) => q.key))).toBeNull();
  });

  it("gives each concurrent edit of one answer its own revision", async () => {
    const texts = ["one", "two", "three", "four", "five"];
    const results = await Promise.all(
      texts.map((answerText) =>
        saveAnswer(alice.id, storyId, { questionKey: "passions", answerText }),
      ),
    );
    const revisions = results.map((r) => r!.answer.revision).sort();
    expect(revisions).toEqual([1, 2, 3, 4, 5]);
  });

  it("rejects a question key that does not exist", async () => {
    await expect(
      saveAnswer(alice.id, storyId, { questionKey: "nope", answerText: "x" }),
    ).rejects.toThrow("Unknown question");
  });

  it("does not let another user save or read answers", async () => {
    await saveAnswer(alice.id, storyId, {
      questionKey: "full_name",
      answerText: "Joseph Ellis",
    });

    const write = await saveAnswer(bob.id, storyId, {
      questionKey: "full_name",
      answerText: "Hacked",
    });
    expect(write).toBeNull();
    expect(await getCurrentAnswers(bob.id, storyId)).toBeNull();
    expect(await getAnswerHistory(bob.id, storyId, "full_name")).toBeNull();

    // Alice's answer is untouched.
    const current = await getCurrentAnswers(alice.id, storyId);
    expect(current?.get("full_name")?.answerText).toBe("Joseph Ellis");
    expect(await getAnswerHistory(alice.id, storyId, "full_name")).toHaveLength(1);
  });
});
