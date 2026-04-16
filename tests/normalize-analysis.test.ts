import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAnalysisPayload } from "../src/background/normalize.ts";

test("normalizeAnalysisPayload parses markdown sections and evidence references", () => {
  const result = normalizeAnalysisPayload({
    content: `
# Thesis
This paper improves retrieval.

# Core method/mechanism
Uses a dual encoder.

# Evidence references
- Figure 2 (p.7): Retrieval architecture
- Table 1 (p.5): Main benchmark
- p.9: Ablation discussion
`
  });

  assert.equal(result.sections[0].id, "thesis");
  assert.equal(result.sections[0].content, "This paper improves retrieval.");
  assert.equal(result.references.length, 3);
  assert.deepEqual(result.references[0], {
    kind: "figure",
    label: "Figure 2",
    page: 7,
    anchorText: "Retrieval architecture"
  });
});
