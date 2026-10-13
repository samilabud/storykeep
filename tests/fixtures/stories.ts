// Story texts used by the export tests and by `pnpm samples`.

export const SHORT_EULOGY = {
  title: "Grandpa Joe",
  kind: "eulogy" as const,
  content: `Grandpa Joe

## The Man We Knew as Joe

His name was Joseph Ellis. But almost nobody called him Joseph. To everyone, he was simply Joe. And to some of us gathered here today, he was Grandpa Joe.

There is something fitting about that. A short name, plain and easy to say, the kind of name you call out across a yard or over a fence.

## Forty Years of Carpentry

Joe was a carpenter for forty years. Carpentry is patient work. It means measuring before you cut, and getting it right so that what you build will hold.

## What Stays With Us

So the next time you climb the steps of one of those porches, take a moment to think of him. Rest a hand on the railing. Remember that someone took the time to build it well.

Thank you, Grandpa Joe. We will miss you.`,
};

const LONG_PARAGRAPH =
  "She kept a garden behind the house on Calle Mayor, and every spring she planted the same rows in the same order: tomatoes, peppers, then the herbs she used for everything. The neighbours came for cuttings and stayed for coffee, and she never let anyone leave without something in their hands. Her mother had done the same, and her grandmother before that, in a village where the well was shared and so was the bread.";

/** Long enough for several pages, with the characters that tend to break exports. */
export const LONG_LIFE_STORY = {
  title: "María José Ñáñez-Brontë",
  kind: "life_story" as const,
  content: [
    "María José Ñáñez-Brontë",
    "",
    "This is the story of a long life, told by the people who loved her. 🌻",
    "",
    "## Zoë's “Grandmother”: Early Years in Köln & São Paulo",
    "",
    "She was born in 1931. Her father, François, said “a child born in winter is never afraid of the cold” — and he was right. Her sister Zoë called her “la pequeña”, which she pretended to dislike.",
    "",
    "Prices then: bread cost 5¢, a tram ticket ½ a peso, and a room was £2 a week. She wrote it all down in a notebook: naïve, façade, coöperate, Ærøskøbing, Łódź, Dvořák.",
    "",
    ...Array.from({ length: 5 }, (_, section) => [
      `## Chapter ${section + 2}: The House on Calle Mayor`,
      "",
      ...Array.from({ length: 5 }, () => [LONG_PARAGRAPH, ""]).flat(),
    ]).flat(),
    "## What She Left Us ❤️",
    "",
    "She left us her recipes, her stubbornness, and a garden that still comes up every spring. Thank you, abuela. 🙏",
  ].join("\n"),
};
