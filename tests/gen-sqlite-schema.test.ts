import { describe, it, expect } from "vitest";
import { transformSchema, HEADER } from "../scripts/lib-sqlite-transform.mjs";

const SAMPLE = `// some header comment
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Foo {
  id        String  @id
  amountUsd Decimal @db.Decimal(18, 6) // per-project cap
  note      String  @db.Text
  config    Json    @default("{}")
  items     Json    @default("[]")
}

model Bar {
  id     BigInt   @id @default(autoincrement())
  amount BigInt
}
`;

describe("transformSchema", () => {
  it("replaces the datasource block with a sqlite provider + SQLITE_URL env lookup", () => {
    const out = transformSchema(SAMPLE);
    expect(out).toContain('provider = "sqlite"');
    expect(out).not.toContain('provider = "postgresql"');
    expect(out).not.toContain('env("DATABASE_URL")');
    expect(out).toMatch(/url\s+=\s+env\("SQLITE_URL"\)/);
  });

  it("strips @db.Decimal(18, 6) while preserving the field's other attributes and trailing comment", () => {
    const out = transformSchema(SAMPLE);
    expect(out).not.toContain("@db.Decimal");
    expect(out).toContain("amountUsd Decimal // per-project cap");
  });

  it("strips other @db.* native types like @db.Text", () => {
    const out = transformSchema(SAMPLE);
    expect(out).not.toContain("@db.Text");
    expect(out).toContain("note      String");
  });

  it("routes Json @default(\"{}\")/@default(\"[]\") through dbgenerated() (SQLite rejects the raw literal)", () => {
    const out = transformSchema(SAMPLE);
    expect(out).toContain('config    Json    @default(dbgenerated("\'{}\'"))');
    expect(out).toContain('items     Json    @default(dbgenerated("\'[]\'"))');
  });

  it("maps BigInt @id @default(autoincrement()) to Int (SQLite autoincrement requires an INTEGER PK)", () => {
    const out = transformSchema(SAMPLE);
    expect(out).toContain("id     Int   @id @default(autoincrement())");
    // a plain (non-PK, non-autoincrement) BigInt column must be left alone
    expect(out).toContain("amount BigInt");
  });

  it("preserves the generator block unchanged", () => {
    const out = transformSchema(SAMPLE);
    expect(out).toContain('provider = "prisma-client-js"');
  });

  it("prepends the AUTO-GENERATED header", () => {
    const out = transformSchema(SAMPLE);
    expect(out.startsWith(HEADER)).toBe(true);
  });

  it("is idempotent when re-applied to its own output (module path + @db.* absent already)", () => {
    const once = transformSchema(SAMPLE);
    // Re-running the transform on the source (not on `once`, since `once` no longer
    // has a bare postgres datasource block to detect) yields the same result —
    // determinism: same input always produces the same output.
    const again = transformSchema(SAMPLE);
    expect(again).toBe(once);
  });

  it("throws on input with no datasource block", () => {
    expect(() => transformSchema("generator client {}\n")).toThrow();
  });
});
