import { ClusterPhysicsSettings } from "../../../settings/categories/ClusterPhysicsSettings";
import SimpleSliderSetting, { SliderOptions } from "../../atomics/SimpleSliderSetting";
import State from "../../../util/State";

const ClusterPhysicsSettingsView = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	ClusterTargetRadiusSetting(settings, containerEl);
	ClusterForceStrengthSetting(settings, containerEl);
	ExplodedTargetRadiusSetting(settings, containerEl);
	ExplodeRepulsionStrengthSetting(settings, containerEl);
	InterClusterSeparationSetting(settings, containerEl);
	InterClusterRepulsionStrengthSetting(settings, containerEl);
};

const ClusterTargetRadiusSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Cluster Tightness (radius)",
		value: settings.value.clusterTargetRadius,
		stepOptions: { min: 20, max: 200, step: 5 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.clusterTargetRadius = value;
	});
};

const ClusterForceStrengthSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Cluster Pull Strength",
		value: settings.value.clusterForceStrength,
		stepOptions: { min: 0.5, max: 10, step: 0.5 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.clusterForceStrength = value;
	});
};

const ExplodedTargetRadiusSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Explode Spread (radius)",
		value: settings.value.explodedTargetRadius,
		stepOptions: { min: 60, max: 500, step: 10 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.explodedTargetRadius = value;
	});
};

const ExplodeRepulsionStrengthSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Explode Repulsion Strength",
		value: settings.value.explodeRepulsionStrength,
		stepOptions: { min: 500, max: 20000, step: 500 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.explodeRepulsionStrength = value;
	});
};

const InterClusterSeparationSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Min. Distance Between Clusters",
		value: settings.value.interClusterSeparation,
		stepOptions: { min: 50, max: 600, step: 10 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.interClusterSeparation = value;
	});
};

const InterClusterRepulsionStrengthSetting = (
	settings: State<ClusterPhysicsSettings>,
	containerEl: HTMLElement
) => {
	const options: SliderOptions = {
		name: "Inter-cluster Repulsion Strength",
		value: settings.value.interClusterRepulsionStrength,
		stepOptions: { min: 0, max: 30, step: 1 },
	};
	return SimpleSliderSetting(containerEl, options, (value) => {
		settings.value.interClusterRepulsionStrength = value;
	});
};

export default ClusterPhysicsSettingsView;
