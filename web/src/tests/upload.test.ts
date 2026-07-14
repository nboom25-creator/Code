import { describe, it, expect } from "vitest";
import { classifyUpload, MAX_UPLOAD_BYTES } from "@/lib/upload";

describe("upload validation", () => {
  it("accepts allowed text/image/pdf types", () => {
    expect(classifyUpload("text/plain", 100).kind).toBe("text");
    expect(classifyUpload("text/csv", 100).kind).toBe("text");
    expect(classifyUpload("image/png", 100).kind).toBe("image");
    expect(classifyUpload("application/pdf", 100).kind).toBe("pdf");
  });

  it("rejects oversized files", () => {
    const r = classifyUpload("image/png", MAX_UPLOAD_BYTES + 1);
    expect(r.kind).toBe("rejected");
    expect(r.reason).toMatch(/limit/i);
  });

  it("rejects empty files", () => {
    expect(classifyUpload("text/plain", 0).kind).toBe("rejected");
  });

  it("rejects disallowed types (e.g. executables)", () => {
    expect(classifyUpload("application/x-msdownload", 100).kind).toBe("rejected");
    expect(classifyUpload("application/zip", 100).kind).toBe("rejected");
  });
});
