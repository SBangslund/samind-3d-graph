import { StateChange } from "src/util/State";
import { AbstractGraphService } from "./AbstractGraphService";

export class SettingsService extends AbstractGraphService {
	public onSettingsStateChanged(data: StateChange) {
		if (data.currentPath === "display.nodeSize") {
			this.instance.nodeRelSize(data.newValue as number);
		} else if (data.currentPath === "display.linkWidth") {
			this.instance.linkWidth(data.newValue as number);
		} else if (data.currentPath === "display.particleSize") {
			this.instance.linkDirectionalParticleWidth(
				this.plugin.getSettings().display.particleSize
			);
		} else if (data.currentPath.startsWith("clusterPhysics.")) {
			// the cluster force reads these values fresh every tick, but the
			// simulation itself has likely already cooled down - reheat so
			// a slider change is immediately visible instead of silently
			// waiting for the next explode/collapse to pick it up
			this.instance.d3ReheatSimulation();
		}

		this.instance.refresh(); // other settings only need a refresh
	};
}