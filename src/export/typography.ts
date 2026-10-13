// One set of numbers for both renderers, in points (1/72 inch). The PDF and
// the DOCX use different engines, so they cannot share code, but they can
// share these values. That is what keeps the two files looking alike.

export const TYPE = {
  titlePt: 28,
  headingPt: 15,
  bodyPt: 11.5,
  smallPt: 9,
  lineHeight: 1.5,
  marginPt: 72, // 1 inch
  headingSpaceBeforePt: 18,
  headingSpaceAfterPt: 6,
  paragraphSpaceAfterPt: 9,
} as const;
