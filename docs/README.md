# Contributor documentation

Start here when maintaining Design Studio AI. The [root README](../README.md) introduces the product and local setup; [AGENTS.md](../AGENTS.md) owns instructions for coding agents working in this repository.

| Decision | Guide |
| --- | --- |
| Understand product intent, constraints, and requested outcomes | [Product brief](product-brief.md) |
| Locate shared contracts, runtime boundaries, and their executable owners | [Architecture](architecture.md) |
| Maintain creative boards, paint persistence and public-source boundaries | [Creative tools](creative-tools.md) |
| Rig and animate native 2D characters | [Character motion](character-motion.md) |
| Configure hosting, secrets, storage, backups, or rollback | [Deployment](deployment.md) |
| Connect an external agent through the product's API, MCP, WebMCP, or CLI | [Agent access](agents.md) |
| Understand provider setup and source-media constraints | [Providers](providers.md) |
| Maintain the public documentation portal, beginner guide, and discovery output | [Web documentation](web-documentation.md) |

[Agent access](agents.md) documents using the product. The installable [design-studio-ai skill](../skills/design-studio-ai/SKILL.md) guides agents creating designs in it. Repository coding-agent behavior belongs in [AGENTS.md](../AGENTS.md).

Use the executable owners linked from each guide for current schemas, routes, commands, and configuration. These guides provide context and navigation; the product brief records requested scope rather than proof of completion.

[Archived plans and reports](https://github.com/bestagentkits/design-studio-ai/tree/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/) preserve historical implementation decisions and observed checks. [Release verification](https://github.com/bestagentkits/design-studio-ai/blob/1a23d4a4a4ca4c14c6c15f2ae7318004a908ce2b/plans/2026-09-07-bootstrap-design-studio-ai/reports/release-v020.md) is evidence for that release, not current implementation authority. New plans and reports stay local in the Git-ignored `plans/` directory. Use source and tests to establish behavior for a new change.

[Editable 3D characters](3d-characters.md) covers mesh, rig, expressions, UV painting and agent commands.

See [durable operation jobs](operation-jobs.md) for save/export recovery, result retention and Cloudflare queue provisioning.
