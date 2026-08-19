import { AbstractGraphService } from "./AbstractGraphService";
import { HighlightService, HydratedLinkObject } from "./HighlightService";
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
            .linkColor((link: HydratedLinkObject) => this.getLinkColor(link))
            .linkDirectionalParticles(settings.display.particleCount)
            .linkWidth((link: HydratedLinkObject) => {
                return this.highlightService.hasLink(link) ? 3 : settings.display.linkThickness;
            })
            .linkDirectionalParticleWidth((link: HydratedLinkObject) => {
                return this.highlightService.hasLink(link) ? 3 : settings.display.particleSize;
            })
            .linkDirectionalParticleSpeed(0.006);
    }


    private getLinkColor(link: HydratedLinkObject): string {
        return this.highlightService.getLinkSize() > 0
            ? (this.highlightService.hasLink(link)
                // theme's --text-accent can be dark/muted depending on the
                // active theme and blends into the background; 'orange' is
                // already this plugin's established highlight color (see
                // the parent-node label styling in NodeService)
                ? 'orange'
                : 'rgba(255, 255, 255, 0.15)')
            : this.plugin.theme.textMuted;
    }
}