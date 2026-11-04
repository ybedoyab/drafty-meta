/**
 * Generation tokens so a late transcription cannot update the wrong scenario
 * or apply after cancel / navigation / unmount.
 */
export class RecordingGuard {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  generationId(): number {
    return this.generation;
  }
}
