// Shallow compare for nested objects
const shallowCompare = (obj1: unknown, obj2: unknown): boolean => {
	if (!obj1 || !obj2) return obj1 === obj2;
	else if (obj1 instanceof Object && obj2 instanceof Object) {
		const keys1 = Object.keys(obj1);
		const keys2 = Object.keys(obj2);
		return (
			keys1.length === keys2.length &&
			keys1.every(
				(key) =>
					Object.prototype.hasOwnProperty.call(obj2, key) &&
					shallowCompare(
						(obj1 as Record<string, unknown>)[key],
						(obj2 as Record<string, unknown>)[key]
					)
			)
		);
	} else return obj1 === obj2;
};

export default shallowCompare;
