# Addy 3D Model: Master Production TODO List

**Status:** Base Humanoid Imported & Live in Blender (`fem_vroid.glb`)  
**Target:** 160 cm Production-Ready 3D Anime Companion Model (OpenMontage Standards)  

---

## 📋 Phase 1: Scene Setup, Orientation & Reference Calibration
- [x] **1.1 Re-orient Base Mesh:** Rotate Armature around $Z$ to face standard Front (`-Y`) [COMPLETED].
- [x] **1.2 Convert to A-Pose:** Rotate upper arms $-45^\circ$ for clean sleeve modeling and skin weighting [COMPLETED - Saved to Pose Library as `APose_45`].
- [x] **1.3 Organize Collections:** Set up standard OpenMontage collections (`00_References`, `01_Anatomy`, `02_Hair`, `03_Garments_Inner`, `04_Jacket_Outer`, `05_Accessories_Footwear`, `06_Armature`) [COMPLETED].
- [ ] **1.4 Setup Reference Planes:** Import Front ($0^\circ$), Side ($90^\circ$), and Back ($180^\circ$) backdrop planes scaled to $1.60\text{ m}$.

---

## 👤 Phase 2: Facial & Head Customization (Components 01–05)
- [x] **2.1 Multi-tier Anime Eye System:** Cornea, recessed iris dish, sclera, and lash cards configured [COMPLETED - Cyan bloom assigned to Iris].
- [x] **2.2 Cyber Neck Seam:** Modeled `Geo_Neck_Collar` undersuit ring with `M_Tech_Obsidian` [COMPLETED].
- [x] **2.3 Facial Blendshape Audit:** 56 shape keys mapped and verified on `Face` [COMPLETED].

---

## 💇 Phase 3: Hair System & Head Accessories (Components 06–08)
- [x] **3.1 Front Bangs & Side Locks:** Modeled `Geo_Hair_Bangs`, `Geo_Hair_Bangs_Center`, `Geo_Hair_Side_L/R`, and face-framing `Geo_Hair_Tress_L/R` in `M_Tech_Cyber_White` [COMPLETED].
- [x] **3.2 Crown Ahoge (Antenna Curl):** Modeled `Geo_Hair_Ahoge` loop with Subsurf and `M_Tech_Cyber_White` [COMPLETED].
- [x] **3.3 Main Posterior Hair Shell:** Two-tier volume with upper crown shell `Geo_Hair_Back` and flowing lower locks `Geo_Hair_Back_Lower` down the back [COMPLETED].
- [x] **3.4 Triangular Hair Clips:** Symmetrical `HairClip_L/R_Frame` and `HairClip_L/R_Light` with `#6EE7FF` cyan emission [COMPLETED].

---

## 👗 Phase 4: Inner Garments & Stockings (Components 09, 10, 13, 15, 18, 20, 22, 23)
- [x] **4.1 High-Neck Compression Top:** Modeled `Geo_Inner_Top` with `M_Tech_Obsidian` [COMPLETED].
- [x] **4.2 Cyber Neck Choker & Pendant:** Modeled `Geo_Neck_Collar`, collar cord `Geo_Neck_Cord`, and inverted triangle cyber crystal `Geo_Neck_Pendant` in `M_Emission_Cyan` [COMPLETED].
- [x] **4.3 Pleated Skirt & Accent Panel:** Modeled `Geo_Skirt_Pleated` and `Geo_Skirt_Left_Panel` in `M_Tech_Cyber_White` [COMPLETED].
- [x] **4.4 Asymmetrical Stockings:** Modeled `Geo_Stocking_L` and `Geo_Stocking_R` in `M_Tech_Dark_Slate` [COMPLETED].
- [x] **4.5 Thigh Garters & Tech Charms:** Modeled `Geo_Thigh_Garter_L/R`, tension buckle `Geo_Thigh_Buckle_R`, hanging metal ring `Geo_Thigh_Ring_L`, and cyan ADDY tag `Geo_Thigh_Charm_L` [COMPLETED].

---

## 🧥 Phase 5: Technical Bomber Jacket & Sneaker Breakdown (Components 11, 12, 14, 16, 17, 19, 21, 24, 25)
- [x] **5.1 Oversized Bomber Jacket:** Modeled `Geo_Jacket_Torso`, open lapels `Geo_Jacket_Lapel_L/R`, and sleeves `Geo_Jacket_Sleeve_L/R` in `M_Tech_Cyber_White` [COMPLETED].
- [x] **5.2 Dual-Layer Hood Assembly:** White shell `Geo_Jacket_Hood`, dark slate lining `Geo_Jacket_Hood_Inner`, cyan tech accent bar `Geo_Hood_Accent_Cyan`, drawstrings `Geo_Hood_String_L/R` with metal toggles `Geo_Hood_Toggle_L/R`, and back ADDY triangle plate `Geo_Jacket_Back_Logo` [COMPLETED].
- [x] **5.3 Tactical Harness & Waist Belt System:** Shoulder harness straps `Geo_Harness_Strap_L/R` with quick-release buckles `Geo_Harness_Buckle_L/R`, waist belt `Geo_Belt_Main` + `Geo_Belt_Buckle`, carabiner ring `Geo_Belt_Metal_Ring`, utility hip pouch `Geo_Belt_Utility_Pouch`, cyan tech charm `Geo_Belt_Tech_Charm`, and hanging strap tails `Geo_Belt_Hanging_Strap_L/R` [COMPLETED].
- [x] **5.4 Cyber Tactical Gloves & Sleeves:** Modeled fingerless tactical gloves `Geo_Glove_L/R` with purple neon trims `Geo_Glove_Trim_L/R`, right sleeve triangle emblem `Geo_Arm_Patch_R` + `Geo_Arm_Patch_R_Emblem`, and left forearm cyber module `Geo_Arm_Module_L` with holographic screen `Geo_Arm_Module_Screen_L` [COMPLETED].
- [x] **5.5 Cyber Sneakers & Prop Satellites:** High-top sneakers `Geo_Sneaker_L/R`, thick platform outsoles `Geo_Sneaker_Sole_L/R` in purple emission, high tongues `Geo_Sneaker_Tongue_L/R` with cyan triangle badges `Geo_Sneaker_Badge_L/R`, floating companion `Geo_Prop_Companion` with satellite purple crystals `Geo_Prop_Companion_Sat_L/R`, energy core `Geo_Prop_Energy_Core`, and holographic halo `Geo_Prop_Halo` [COMPLETED].

---

## 🎨 Phase 6: PBR Materials, Shaders & Decal Application (Eevee Next)
- [x] **6.1 Color Palette Shaders:** Initialized and applied all core materials (`M_Tech_Obsidian`, `M_Tech_Dark_Slate`, `M_Tech_Cyber_White`, `M_Emission_Cyan`, `M_Emission_Purple`, `M_Tech_Chrome`, `M_Skin_Anime_Porcelain`) [COMPLETED].
- [x] **6.2 Concept Shaders & Graphic Decals:** Configured vertical anime gradient hair shader (`M_Hair_Anime_Gradient`), asymmetrical stocking materials (`M_Stocking_Circuit_Cyan`, `M_Stocking_Stripe_Purple`), typography plates (`Geo_Inner_Top_Logo_ADDY`, `Geo_Jacket_Back_ADDY_Text`), sneaker criss-cross laces, and chrome metallic buckles [COMPLETED].
- [x] **6.3 Comprehensive Color Fill & Verification:** Standard View Transform calibrated, radiant porcelain skin, sapphire/cyan eyes, glowing halo ring, obsidian inner compression top with white chest logo, open cyber white bomber jacket with lapels, and sneaker outsoles verified in front and rear studio renders [COMPLETED].
- [x] **6.4 Full Anime Lookdev & Cel-Shading:** Converted hair (`M_Hair_Anime_Gradient`), cyber white jacket (`M_Tech_Cyber_White`), obsidian inner top (`M_Tech_Obsidian`), and skin (`M_Skin_Anime_Porcelain`) to 2-tone Anime Cel-Shaders with crisp shadow terminators. Restored authentic anime facial features (delicate transparent curved eyeliner/eyelashes, expressive sapphire-blue/cyan anime irises with catchlights, soft anime pink mouth, and blushing porcelain cheeks) [COMPLETED].

---

## 🦴 Phase 7: Rigging Extension, Studio Lighting & QA
- [x] **7.1 Garment Skinning & Rig Binding:** Core wearable garments (`Geo_Inner_Top`, `Geo_Skirt_Pleated`, `Geo_Stocking_L/R`, `Geo_Jacket_Torso`) bound to `Armature` with automatic vertex groups [COMPLETED].
- [x] **7.2 Anime Studio 3-Point Lighting:** Balanced studio setup (`Light_Key` 140W, `Light_Fill` 70W, dual rim lights `Light_Rim_Cyan` & `Light_Rim_Purple` 120W) with Standard color management [COMPLETED].
- [ ] **7.3 Secondary Jiggle Bones:** Physics chains for Ahoge, bangs, rear hair, hood strings, and belt tails.
- [ ] **7.4 QA Scale & Geometry Audit:** Confirm 1.60m height, ground contact at $Z=0$, zero non-manifold geometry.
- [ ] **7.5 24-Frame Turntable Render:** Render $15^\circ$ orbit sequence and verify against reference sheet.

---

## 🌟 Phase 8: 5-Sheet Component Breakdown Fidelity & Texture Overhaul (Components 01–25)
- [x] **8.1 Sheet 1/5: Face, Eyes, Brows, Lips & Porcelain Skin (01–05):** Winged anime cat-eye eyeliner (`addy_eyeline_hd.png`), lavender arched eyebrows (`addy_eyebrow_hd.png`), porcelain skin with rosy blush & glossy lips (`addy_face_skin_hd.png`), cosmic iris (`addy_eye_iris_hd.png`), and dual catchlights (`addy_eye_highlight_hd.png`) [COMPLETED].
- [x] **8.2 Sheet 2/5: Hair System & Mecha Triangle Clips (06–08):** Re-anchored mecha hair clips on outer locks ($X=\pm 0.096\text{ m}, Y=0.075\text{ m}, Z=1.485\text{ m}$), tuned silver-lavender vertical gradient shader (`M_Hair_Anime_Gradient`), and elevated bangs to frame eyes [COMPLETED].
- [x] **8.3 Sheet 3/5 & 4/5: Bomber Jacket, Inner Top & Skirt (09–20):** Flush white "ADDY" chest typography decal, glowing cyan Delta necklace pendant, open-front bomber lapels, draped dual-layer hood, glowing cyan Delta crest on back panel, and 20-knife-pleat skirt with 12mm glowing cyan hemline stripe [COMPLETED].
- [x] **8.4 Sheet 5/5: Holographic Circuitry & Platform Sneakers (21–25):** Right leg holographic purple/cyan circuitry traces (`addy_stocking_circuit_hd.png`), left leg sheer stocking with garter straps and charm, and chunky platform sneakers with black mecha side brackets, padded tongue, and glowing cyan sole energy pods [COMPLETED].
- [x] **8.5 Live GUI Refresh & 4-Angle Verification:** Synced active Blender GUI session (`addy_production.blend`), calibrated 360-degree studio lighting, and rendered beauty portrait, full hero front, rear back crest, sneaker details, and 4-quadrant contact sheet [COMPLETED].

