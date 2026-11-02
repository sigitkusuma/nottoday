import { describe, expect, it } from "vitest";
import { idProblems, listNameError, pickerMode, suggestListName, whereToFindIds } from "../src/web/listPicker";

describe("suggestListName", () => {
  it("names the list after what the field is for, and keeps names unique", () => {
    expect(suggestListName("mentionIn", [])).toBe("mentions");
    expect(suggestListName("mentionIn", ["mentions"])).toBe("mentions-2");
    expect(suggestListName("mentionIn", ["mentions", "mentions-2"])).toBe("mentions-3");
    expect(suggestListName("excludeChannels", ["excluded-channels"])).toBe("excluded-channels-2");
  });
});

describe("listNameError", () => {
  it("accepts a fresh name and explains the problem otherwise", () => {
    expect(listNameError("oncall", ["other"])).toBe("");
    expect(listNameError("  ", [])).toContain("Give the list a name");
    expect(listNameError("on call", [])).toContain("letters, digits");
    expect(listNameError("oncall", ["oncall"])).toContain("already exists");
  });
});

describe("idProblems", () => {
  it("flags values that can't be Slack IDs of the right kind", () => {
    expect(idProblems(["U01ABC23", "W9XYZ12", "john", "C01ABC23"], "person")).toEqual(["john", "C01ABC23"]);
    expect(idProblems(["C01ABC23", "G0ABC123", "D0ABC123", "#support", "U01ABC23"], "channel")).toEqual(["#support", "U01ABC23"]);
    expect(idProblems([], "person")).toEqual([]);
  });
});

describe("pickerMode", () => {
  it("tells a saved list from typed IDs from nothing", () => {
    expect(pickerMode("")).toBe("none");
    expect(pickerMode("   ")).toBe("none");
    expect(pickerMode("@oncall")).toBe("list");
    expect(pickerMode("U01ABC23, U02DEF45")).toBe("ids");
  });
});

describe("whereToFindIds", () => {
  it("gives directions for people and for channels", () => {
    expect(whereToFindIds("person")).toContain("Copy member ID");
    expect(whereToFindIds("channel")).toContain("Channel ID");
  });
});
