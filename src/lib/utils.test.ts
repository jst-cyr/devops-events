import { describe, expect, it } from "vitest"

import { cn } from "./utils"

describe("cn", () => {
  it("merges tailwind classes with last one winning", () => {
    expect(cn("px-2 py-1", "px-4", "text-sm")).toBe("py-1 px-4 text-sm")
  })

  it("includes conditional classes", () => {
    expect(cn("base", false && "hidden", true && "visible")).toBe("base visible")
  })
})
