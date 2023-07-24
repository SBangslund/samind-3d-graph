import { ForceGraph3DInstance } from "3d-force-graph";
import Graph3dPlugin from "src/main";

export abstract class AbstractGraphService {
    constructor(
        protected instance: ForceGraph3DInstance,
        protected plugin: Graph3dPlugin) {
    }
}