import Link from "src/graph/Link";
import Node from "../../../graph/Node";
import { AbstractGraphService } from "./AbstractGraphService";

export class HighlightService extends AbstractGraphService {
	private readonly links: Set<Link> = new Set();
	private readonly nodes: Set<string> = new Set();

    public update(): void {
        this.instance
			.nodeColor(this.instance.nodeColor())
			.linkColor(this.instance.linkColor())
			.linkDirectionalParticles(this.instance.linkDirectionalParticles());
    }

    public clear(): void {
        this.links.clear();
        this.nodes.clear();
    }

    public addLink(link: Link): void {
        this.links.add(link);
    }

    public addNode(node: Node): void {
        this.nodes.add(node.id);
    }

	public hasLink(link: Link): boolean {
		return this.links.has(link);
	};

    public hasNode(node: Node): boolean {
        return this.nodes.has(node.id);
    }

    public getLinkSize(): number {
        return this.links.size;
    }

    public getNodeSize(): number {
        return this.nodes.size;
    }
}