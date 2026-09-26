# PlantUML offline runtime locks and notices

Reviewed: 2026-09-26

This directory contains pinned source metadata and upstream license/notice text only. PlantUML JAR and Temurin JDK ZIP binaries are not committed to Git; the later preparation step must download these exact versioned assets, verify their SHA-256 values, and keep generated runtime artifacts in ignored build output.

## Fixed upstream artifacts

| Artifact | Exact source | Size | SHA-256 verification |
|---|---|---:|---|
| PlantUML LGPL 1.2026.8 | [Release asset](<https://github.com/plantuml/plantuml/releases/download/v1.2026.8/plantuml-lgpl-1.2026.8.jar>) | 17,738,545 bytes | `99e271611aa65a2319c0a4502ae9a4289f02933fdcc4f96a4e2f62a9b4e5b4ce`, computed from the downloaded LGPL JAR bytes |
| Eclipse Temurin JDK 21.0.12+8, Windows x64 | [Release asset](<https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip>) | 205,069,442 bytes | `9ba963ee2371874a74185d18bc7bb2ab9407df7683300855ed7606e0662321d0`, computed locally and matched against the [same-release official checksum file](<https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12%2B8/OpenJDK21U-jdk_x64_windows_hotspot_21.0.12_8.zip.sha256.txt>) |

PlantUML is pinned to the official v1.2026.8 LGPL asset, not the similarly versioned standard `plantuml-1.2026.8.jar`; no checksum for the standard JAR was reused. The JAR reports `PlantUML version 1.2026.8 / 149874a` and `(LGPL source distribution)`. The pinned Temurin archive's `release` file reports `IMPLEMENTOR="Eclipse Adoptium"`, `IMPLEMENTOR_VERSION="Temurin-21.0.12+8"`, `JAVA_VERSION="21.0.12"`, and `OS_ARCH="x86_64"`.

The anonymous GitHub release API returned HTTP 403 rate-limit responses during review. No API-provided digest was assumed; exact official versioned asset URLs were downloaded directly. The Temurin ZIP hash was independently cross-checked with its official release sidecar. PlantUML's digest is the locally computed SHA-256 of the actual LGPL asset bytes.

## Licensing sources

- PlantUML's [official download/licensing page](https://plantuml.com/download) lists the LGPL flavor and states that the LGPL version is the choice without embedded GraphViz.
- `PLANTUML-LICENSE.txt` includes the complete flavor notice from [plantuml-lgpl/lgpl-license.txt at v1.2026.8](https://raw.githubusercontent.com/plantuml/plantuml/v1.2026.8/plantuml-lgpl/lgpl-license.txt) and the complete LGPL v3 text from [COPYING.LESSER at v1.2026.8](https://raw.githubusercontent.com/plantuml/plantuml/v1.2026.8/COPYING.LESSER). SPDX: `LGPL-3.0-or-later`.
- `TEMURIN-NOTICE.txt` retains all upstream `legal/<module>/<filename>` texts from the Temurin ZIP for the module closure listed below. It includes OpenJDK GPL v2, the Classpath and Assembly exceptions, and per-module third-party attributions (for example FreeType, HarfBuzz, ICU, Xalan, Xerces, and others). Upstream filenames and wording are retained; only line endings and trailing horizontal whitespace are normalized for repository text hygiene.

## Module analysis and smoke verification

Using the pinned JDK's `jdeps.exe` (21.0.12):

```text
jdeps --multi-release 21 --ignore-missing-deps --print-module-deps plantuml-lgpl-1.2026.8.jar
java.base,java.desktop,java.logging,java.prefs,java.scripting
```

The lock's `modules` array is exactly this command's output. Without `--ignore-missing-deps`, the full JAR scan reports unresolved package references from bundled optional Ant tasks, OpenPDF integration, and TeaVM/browser code (`org.apache.tools.ant.*`, `org.openpdf.*`, `org.teavm.*`). This scan therefore records the JDK module dependencies while leaving optional non-JDK paths for the step 3 offline runtime matrix to validate. The non-static `requires` closure read from the corresponding pinned JMOD descriptors is `java.base, java.datatransfer, java.desktop, java.logging, java.prefs, java.scripting, java.xml`; legal texts for all seven module directories are included.

An offline PicoWeb smoke test ran from the exact downloaded JAR using the pinned JDK with `PLANTUML_SECURITY_PROFILE=SANDBOX`, `-disablestats`, and `-picoweb:<random-port>:127.0.0.1`. The process environment omitted `GRAPHVIZ_DOT` and used a sanitized `PATH` with no `dot` executable. The official fixed UML sample request to `127.0.0.1` returned HTTP 200 and an SVG (2,101 UTF-8 bytes); the process was stopped and its port released. This confirms the tested sequence UML diagram and PicoWeb path work without GraphViz discovery; it does not claim that GraphViz-dependent diagram families work without a separate GraphViz installation.

Still pending: building a jlink runtime, validating its reduced module closure, broader offline diagram matrix, runtime packaging, and installer verification. These are later plan steps and were not claimed as complete here.
