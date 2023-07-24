import Link from "src/graph/Link";
import { AbstractGraphService } from "./AbstractGraphService";
import { HighlightService } from "./HighlightService";
import { ForceGraph3DInstance } from "3d-force-graph";
import Graph3dPlugin from "src/main";

export class LinkService extends AbstractGraphService {

    constructor(
        instance: ForceGraph3DInstance,
        plugin: Graph3dPlugin,
        private highlightService: HighlightService) {
        super(instance, plugin);
    }

    public init(): void {
        const settings = this.plugin.getSettings();
        this.instance
            .linkColor((link: Link) => this.getLinkColor(link))
            .linkDirectionalParticles(settings.display.particleCount)
            .linkWidth((link: Link) => {
                return this.highlightService.hasLink(link) ? 3 : settings.display.linkThickness;
            })
            .linkDirectionalParticleWidth((link: Link) => {
                return this.highlightService.hasLink(link) ? 3 : settings.display.particleSize;
            })
            .linkDirectionalParticleSpeed(0.006);
    }


    private getLinkColor(link: Link): string {
        return this.highlightService.getLinkSize() > 0
            ? (this.highlightService.hasLink(link)
                ? this.plugin.theme.textAccent
                : 'rgba(255, 255, 255, 0.15)')
            : this.plugin.theme.textMuted;
    }
}