/**
 * SemanticEmbedder — optional wrapper around @xenova/transformers.
 *
 * Loaded lazily; falls back gracefully if the package is not installed.
 * Uses Xenova/all-MiniLM-L6-v2 (384-dim, ~22 MB download on first use).
 */

/** 384-dim unit vector. Cosine similarity = dot product when vectors are normalized. */
export type EmbeddingVector = Float32Array;

export class SemanticEmbedder {
  private pipeline: ((text: string, opts: Record<string, unknown>) => Promise<{ data: number[] }>) | null = null;
  private _initPromise: Promise<void> | null = null;
  private _available = false;

  /**
   * Try to initialize the embedding pipeline.
   * Resolves without throwing even if @xenova/transformers is unavailable.
   */
  async tryInitialize(): Promise<boolean> {
    if (this._initPromise) {
      await this._initPromise;
      return this._available;
    }
    this._initPromise = this._load();
    await this._initPromise;
    return this._available;
  }

  private async _load(): Promise<void> {
    try {
      // Dynamic import keeps it optional — if the package isn't installed, this throws.
      const { pipeline, env } = await import('@xenova/transformers' as string);
      // Use local cache in the user's home directory (standard HF cache location).
      env.cacheDir = undefined; // use default (~/.cache/huggingface/hub)
      this.pipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true,
      });
      this._available = true;
    } catch {
      this._available = false;
    }
  }

  get isAvailable(): boolean {
    return this._available;
  }

  /**
   * Embed a text string. Returns a normalized 384-dim Float32Array.
   * Throws if the embedder was not successfully initialized.
   */
  async embed(text: string): Promise<EmbeddingVector> {
    if (!this._available || !this.pipeline) {
      throw new Error('SemanticEmbedder is not available. Install @xenova/transformers to enable semantic search.');
    }
    const output = await this.pipeline(text, { pooling: 'mean', normalize: true });
    return new Float32Array(output.data);
  }

  /**
   * Cosine similarity between two normalized vectors.
   * For unit vectors, this is equivalent to the dot product.
   */
  static cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
    let dot = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  /**
   * Build a text string to embed for a function entity.
   */
  static functionText(name: string, signature: string, docComment: string): string {
    return [name, signature, docComment].filter(Boolean).join(' ').trim().slice(0, 512);
  }

  /**
   * Build a text string to embed for a class entity.
   */
  static classText(name: string, methods: string[]): string {
    const methodNames = methods.map((m) => m.split(':').pop() || m);
    return `class ${name} ${methodNames.slice(0, 10).join(' ')}`.trim().slice(0, 512);
  }
}
