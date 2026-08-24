import Link from "src/graph/Link";
import Node from "src/graph/Node";
import { AbstractGraphService } from "./AbstractGraphService";

// Once the simulation has run, 3d-force-graph replaces a link's source/target
// path strings with the actual resolved node objects - this is the shape link
// callbacks (linkColor, linkWidth, ...) actually receive at runtime.
export interface HydratedLinkObject {
    source: { path: string };
    target: { path: string };
}

export class HighlightService extends AbstractGraphService {
    private readonly links: Set<Link> = new Set();
    private readonly nodes: Set<string> = new Set();
    private readonly parents: Set<string> = new Set();
    // MCP-requested primary nodes — rendered with a distinct accent so they
    // stand out from the connected neighbors that are also in `nodes`
    private readonly primaryNodes: Set<string> = new Set();

    public update(): void {
        this.instance
            .nodeColor(this.instance.nodeColor())
            .linkColor(this.instance.linkColor());
    }

    public clear(): void {
        this.links.clear();
        this.nodes.clear();
        this.parents.clear();
        this.primaryNodes.clear();
    }

    public addPrimaryNode(id: string): void {
        this.primaryNodes.add(id);
    }

    public isPrimaryNode(node: Node): boolean {
        return this.primaryNodes.has(node.id);
    }

    public getPrimarySize(): number {
        return this.primaryNodes.size;
    }

    public addLink(link: Link): void {
        this.links.add(link);
    }

    public addNode(id: string): void {
        this.nodes.add(id);
    }

    public addParent(id: string): void {
        this.parents.add(id);
    }

    public hasLink(link: HydratedLinkObject): boolean {
        let links = this.links.values();
        for (let index = 0; index < this.links.size; index++) {
            const element = links.next();
            if ((element.value as Link).source === link.source.path
                && (element.value as Link).target === link.target.path) {
                return true;
            }
        }
        return false;
    };

    public hasNode(node: Node): boolean {
        return this.nodes.has(node.id);
    }

    public isParent(node: Node): boolean {
        return this.parents.has(node.id);
    }

    public parentIndex(node: Node): number {
        let keys = this.parents.keys();
        for (let index = 0; index < this.parents.size; index++) {
            let key = keys.next();
            if (key.value === node.id) {
                return index;
            }
        }
        return -1;
    }

    public getLinkSize(): number {
        return this.links.size;
    }

    public getNodeSize(): number {
        return this.nodes.size;
    }

    public getParentSize(): number {
        return this.parents.size;
    }
}