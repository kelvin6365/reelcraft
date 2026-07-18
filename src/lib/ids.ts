import { uuidv7 } from "uuidv7";

// UUID v7: time-ordered, index-friendly. All PKs are generated app-side via this.
export function newId(): string {
  return uuidv7();
}
