export type JsonSchema = Record<string, unknown>;

export class Schema {
  readonly json: JsonSchema;
  isOptional = false;

  constructor(json: JsonSchema) {
    this.json = json;
  }

  optional(): this {
    this.isOptional = true;
    return this;
  }

  describe(description: string): this {
    this.json.description = description;
    return this;
  }

  min(value: number): this {
    if (this.json.type === "string") this.json.minLength = value;
    else if (this.json.type === "array") this.json.minItems = value;
    else this.json.minimum = value;
    return this;
  }

  max(value: number): this {
    if (this.json.type === "string") this.json.maxLength = value;
    else if (this.json.type === "array") this.json.maxItems = value;
    else this.json.maximum = value;
    return this;
  }

  int(): this {
    this.json.type = "integer";
    return this;
  }

  validate(value: unknown, field: string): string | null {
    if (value === undefined) return this.isOptional ? null : `${field} is required`;
    const type = this.json.type;
    if (type === "string" && typeof value !== "string") return `${field} must be a string`;
    if ((type === "number" || type === "integer") && typeof value !== "number") return `${field} must be a number`;
    if (type === "integer" && !Number.isInteger(value)) return `${field} must be an integer`;
    if (type === "boolean" && typeof value !== "boolean") return `${field} must be a boolean`;
    if (type === "array" && !Array.isArray(value)) return `${field} must be an array`;
    if (Array.isArray(this.json.enum) && !this.json.enum.includes(value)) return `${field} has an unsupported value`;
    if (typeof value === "string" && typeof this.json.minLength === "number" && value.length < this.json.minLength) {
      return `${field} is too short`;
    }
    if (Array.isArray(value)) {
      if (typeof this.json.minItems === "number" && value.length < this.json.minItems) return `${field} has too few items`;
      if (typeof this.json.maxItems === "number" && value.length > this.json.maxItems) return `${field} has too many items`;
      const item = this.json.items;
      if (item instanceof Schema) {
        for (let i = 0; i < value.length; i += 1) {
          const error = item.validate(value[i], `${field}[${i}]`);
          if (error) return error;
        }
      }
    }
    if (typeof value === "number") {
      if (typeof this.json.minimum === "number" && value < this.json.minimum) return `${field} is below minimum`;
      if (typeof this.json.maximum === "number" && value > this.json.maximum) return `${field} is above maximum`;
    }
    return null;
  }
}

export const z = {
  string: () => new Schema({ type: "string" }),
  boolean: () => new Schema({ type: "boolean" }),
  number: () => new Schema({ type: "number" }),
  enum: (values: readonly string[]) => new Schema({ type: "string", enum: [...values] }),
  array: (item: Schema) => new Schema({ type: "array", items: item }),
  any: () => new Schema({}),
};
