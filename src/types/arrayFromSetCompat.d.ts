export {};

declare global {
  interface ArrayConstructor {
    from(arrayLike: Set<string>): string[];
  }
}
