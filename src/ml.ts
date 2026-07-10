/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A simple, robust, high-performance Decision Tree Node.
 */
interface TreeNode {
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
  value?: number; // Leaf node value (class or class probability)
  isLeaf: boolean;
}

/**
 * Single Decision Tree Classifier implemented in TypeScript.
 */
export class DecisionTreeClassifier {
  private root: TreeNode | null = null;
  private maxDepth: number;
  private minSamplesSplit: number;

  constructor(maxDepth = 15, minSamplesSplit = 5) {
    this.maxDepth = maxDepth;
    this.minSamplesSplit = minSamplesSplit;
  }

  public fit(X: number[][], y: number[]): void {
    const featureCount = X[0]?.length || 0;
    this.root = this.buildTree(X, y, 0, featureCount);
  }

  private buildTree(X: number[][], y: number[], depth: number, featureCount: number): TreeNode {
    const sampleCount = X.length;

    // Check stop criteria
    if (
      depth >= this.maxDepth ||
      sampleCount < this.minSamplesSplit ||
      this.isHomogeneous(y)
    ) {
      return { isLeaf: true, value: this.majorityVote(y) };
    }

    // Select random subset of features (Feature Bagging)
    const featuresToTry: number[] = [];
    const allFeatures = Array.from({ length: featureCount }, (_, i) => i);
    const subsetSize = Math.max(1, Math.floor(Math.sqrt(featureCount)));
    
    // Shuffle and pick subsetSize features
    for (let i = 0; i < subsetSize; i++) {
      if (allFeatures.length === 0) break;
      const idx = Math.floor(Math.random() * allFeatures.length);
      featuresToTry.push(allFeatures.splice(idx, 1)[0]);
    }

    // Find the best split
    let bestGiniGain = -1;
    let bestFeatureIndex = -1;
    let bestThreshold = -1;
    let bestLeftIndices: number[] = [];
    let bestRightIndices: number[] = [];

    const currentGini = this.calculateGini(y);

    for (const featIdx of featuresToTry) {
      const values = X.map((row) => row[featIdx]);
      // Try unique thresholds
      const uniqueValues = Array.from(new Set(values)).sort((a, b) => a - b);
      
      for (let i = 0; i < uniqueValues.length - 1; i++) {
        const threshold = (uniqueValues[i] + uniqueValues[i + 1]) / 2;
        const leftIdx: number[] = [];
        const rightIdx: number[] = [];

        for (let j = 0; j < sampleCount; j++) {
          if (X[j][featIdx] <= threshold) {
            leftIdx.push(j);
          } else {
            rightIdx.push(j);
          }
        }

        if (leftIdx.length === 0 || rightIdx.length === 0) continue;

        const leftY = leftIdx.map((idx) => y[idx]);
        const rightY = rightIdx.map((idx) => y[idx]);

        const leftGini = this.calculateGini(leftY);
        const rightGini = this.calculateGini(rightY);

        const weightedGini =
          (leftIdx.length / sampleCount) * leftGini +
          (rightIdx.length / sampleCount) * rightGini;

        const giniGain = currentGini - weightedGini;

        if (giniGain > bestGiniGain) {
          bestGiniGain = giniGain;
          bestFeatureIndex = featIdx;
          bestThreshold = threshold;
          bestLeftIndices = leftIdx;
          bestRightIndices = rightIdx;
        }
      }
    }

    // If no split improves Gini, make a leaf
    if (bestFeatureIndex === -1 || bestGiniGain <= 0) {
      return { isLeaf: true, value: this.majorityVote(y) };
    }

    // Recursively build child nodes
    const leftX = bestLeftIndices.map((idx) => X[idx]);
    const leftY = bestLeftIndices.map((idx) => y[idx]);
    const rightX = bestRightIndices.map((idx) => X[idx]);
    const rightY = bestRightIndices.map((idx) => y[idx]);

    return {
      isLeaf: false,
      featureIndex: bestFeatureIndex,
      threshold: bestThreshold,
      left: this.buildTree(leftX, leftY, depth + 1, featureCount),
      right: this.buildTree(rightX, rightY, depth + 1, featureCount),
    };
  }

  private isHomogeneous(y: number[]): boolean {
    if (y.length === 0) return true;
    const first = y[0];
    return y.every((val) => val === first);
  }

  private majorityVote(y: number[]): number {
    if (y.length === 0) return 0.5;
    const counts: { [key: number]: number } = {};
    let maxCount = -1;
    let vote = 0.5;

    for (const val of y) {
      counts[val] = (counts[val] || 0) + 1;
      if (counts[val] > maxCount) {
        maxCount = counts[val];
        vote = val;
      }
    }
    return vote;
  }

  private calculateGini(y: number[]): number {
    const count = y.length;
    if (count === 0) return 0;

    const counts: { [key: number]: number } = {};
    for (const val of y) {
      counts[val] = (counts[val] || 0) + 1;
    }

    let sumSquares = 0;
    for (const key in counts) {
      const p = counts[key] / count;
      sumSquares += p * p;
    }

    return 1 - sumSquares;
  }

  public predictRow(row: number[]): number {
    let curr = this.root;
    while (curr && !curr.isLeaf) {
      const val = row[curr.featureIndex!];
      if (val <= curr.threshold!) {
        curr = curr.left!;
      } else {
        curr = curr.right!;
      }
    }
    return curr ? (curr.value ?? 0.5) : 0.5;
  }
}

/**
 * Random Forest Classifier implemented in TypeScript.
 */
export class RandomForestClassifier {
  private trees: DecisionTreeClassifier[] = [];
  private treeCount: number;
  private maxDepth: number;
  private minSamplesSplit: number;

  constructor(treeCount = 100, maxDepth = 15, minSamplesSplit = 5) {
    this.treeCount = treeCount;
    this.maxDepth = maxDepth;
    this.minSamplesSplit = minSamplesSplit;
  }

  public fit(X: number[][], y: number[]): void {
    this.trees = [];
    const sampleCount = X.length;
    if (sampleCount === 0) return;

    for (let i = 0; i < this.treeCount; i++) {
      // Bootstrapping: Sample with replacement
      const bootX: number[][] = [];
      const bootY: number[] = [];
      for (let j = 0; j < sampleCount; j++) {
        const randIdx = Math.floor(Math.random() * sampleCount);
        bootX.push(X[randIdx]);
        bootY.push(y[randIdx]);
      }

      const tree = new DecisionTreeClassifier(this.maxDepth, this.minSamplesSplit);
      tree.fit(bootX, bootY);
      this.trees.push(tree);
    }
  }

  /**
   * Predict probability of "Accept" (action = 1) or higher feedback.
   * Map actions (0 -> 0%, 0.5 -> 50%, 1 -> 100%) to a continuous probability.
   */
  public predictProbability(row: number[]): number {
    if (this.trees.length === 0) return 0.5;

    let sum = 0;
    for (const tree of this.trees) {
      const val = tree.predictRow(row);
      sum += val; // val is 0, 0.5, or 1
    }
    return sum / this.trees.length;
  }

  /**
   * Evaluate classifier accuracy on a validation split.
   */
  public static evaluate(
    X_train: number[][],
    y_train: number[],
    X_val: number[][],
    y_val: number[]
  ): number {
    const rf = new RandomForestClassifier(50, 10, 5); // Lightweight split for evaluation
    rf.fit(X_train, y_train);

    let correct = 0;
    for (let i = 0; i < X_val.length; i++) {
      const prob = rf.predictProbability(X_val[i]);
      // Round to nearest label in [0, 0.5, 1]
      const pred = prob < 0.25 ? 0 : prob < 0.75 ? 0.5 : 1;
      if (pred === y_val[i]) {
        correct++;
      }
    }
    return X_val.length === 0 ? 1.0 : correct / X_val.length;
  }
}

/**
 * Feature Extractor to prepare inputs for the Random Forest model.
 * Normalize everything to a stable [0, 1] scale.
 */
export function extractFeatures(
  skillMatchScore: number, // 0-100
  experienceDifference: number, // years
  locationDistance: number, // km
  salaryOverlapPercentage: number, // 0-100
  embeddingSimilarity: number // 0-100
): number[] {
  // Normalize skill match (0-100 -> 0-1)
  const f_skill = skillMatchScore / 100;

  // Normalize experience diff (-10 to 10 years -> 0-1)
  const f_exp = Math.min(1, Math.max(0, (experienceDifference + 10) / 20));

  // Normalize location distance (0 to 1000km -> 0-1 where 1 is close, 0 is far)
  const f_loc = Math.max(0, 1 - locationDistance / 1000);

  // Normalize salary overlap (0-100 -> 0-1)
  const f_sal = salaryOverlapPercentage / 100;

  // Normalize embedding similarity (0-100 -> 0-1)
  const f_embed = embeddingSimilarity / 100;

  return [f_skill, f_exp, f_loc, f_sal, f_embed];
}
