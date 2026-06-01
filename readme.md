# Grid-Aware Auras (Lasossis's Fork)

[![Latest module version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgithub.com%2FAgraael%2FFoundryVTT-Grid-Aware-Auras%2Freleases%2Flatest%2Fdownload%2Fmodule.json&query=%24.version&prefix=v&style=for-the-badge&label=module%20version)](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras/releases/latest)
![Latest Foundry version](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fgithub.com%2FAgraael%2FFoundryVTT-Grid-Aware-Auras%2Freleases%2Flatest%2Fdownload%2Fmodule.json&query=%24.compatibility.verified&style=for-the-badge&label=foundry%20version&color=fe6a1f)
<br/>
[![GitHub downloads (total)](https://img.shields.io/github/downloads/Agraael/FoundryVTT-Grid-Aware-Auras/release.zip?style=for-the-badge&label=downloads%20(total))](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras/releases/latest)
[![GitHub downloads (latest version)](https://img.shields.io/github/downloads/Agraael/FoundryVTT-Grid-Aware-Auras/latest/release.zip?style=for-the-badge&label=downloads%20(latest))](https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras/releases/latest)

This is a personal fork of [Grid-Aware Auras](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) by **(Wibble199)**, maintained for my own use with additional features

---

## Installation

Since this module is not listed in the Foundry package registry, install it manually via the manifest URL:

1. In Foundry VTT, go to **Add-on Modules → Install Module**
2. Paste the following URL in the **Manifest URL** field:

```
https://github.com/Agraael/FoundryVTT-Grid-Aware-Auras/releases/latest/download/module.json
```

3. Click **Install**

---

## Changes from upstream

### Features added

**Alt key / dynamic THT rulers**
- Holding `Alt` dynamically shows Terrain Height Tools rulers for all controlled tokens' auras configured with key press visibility
- New visibility modes: **"Only when key pressed"** and **"Also when key pressed"**, with configurable key (`Alt`, `Ctrl`, `Shift`)

**Aura animation**
- Border animation: scroll (animated dashes) and pulse (opacity breathing)
- Configurable animation speed; pulse can target max opacity or fade to a minimum
- Option to animate only when the token is selected
- Fill texture animation: scrolling fill texture with configurable angle and speed

**Line glow**
- Optional blur/glow filter on the border line, with configurable strength

**Radius offset**
- Pixel-level inward/outward nudge applied to the aura shape, independent of radius

**Combat-only mode**
- Aura can be configured to only appear while a combat encounter is active

**Unified aura rendering**
- When multiple tokens share an identical aura configuration their auras visually merge into a single shape (fill and border fuse seamlessly)


**THT tab enhancements**
- `onlyWhenAltPressed`: Terrain Height Tools ruler only activates while Alt is held
- `onlyWhenTargeted`: Terrain Height Tools ruler only activates when the token is targeted

**Elevation-aware aura (THT)**
- `elevationAware` toggle: clips the aura against solid terrain taller than the source's eye height. Affects both the visual and enter/leave checks.



## Credits

Original module by [Wibble199](https://github.com/Wibble199/FoundryVTT-Grid-Aware-Auras) — all credit for the core system goes to them.
