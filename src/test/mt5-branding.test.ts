import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const at = (path: string) => resolve(root, path);

describe("MT5 branding assets", () => {
  it("ships the icon in the UI and the installable web manifest", () => {
    const icon = "public/plotos/assets/mt5-app-icon.png";
    const manifest = JSON.parse(readFileSync(at("public/plotos/manifest.json"), "utf8"));
    const html = readFileSync(at("public/plotos/index.html"), "utf8");

    expect(existsSync(at(icon))).toBe(true);
    expect(html).toContain("assets/mt5-app-icon.png");
    expect(html).toContain("MT5-style simulator");
    for (const entry of manifest.icons) {
      expect(existsSync(at(`public/plotos/${entry.src}`))).toBe(true);
    }
  });

  it("ships matching Android and iOS launcher assets", () => {
    const androidXml = readFileSync(
      at("android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml"),
      "utf8",
    );
    expect(androidXml).toContain("mt5_launcher_background");

    const iosIcon = readFileSync(
      at("ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"),
    );
    expect(iosIcon.toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
    expect(iosIcon.readUInt32BE(16)).toBe(1024);
    expect(iosIcon.readUInt32BE(20)).toBe(1024);
  });
});
