export interface PromptVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'text';
  description?: string;
  required?: boolean;
  defaultValue?: string | number | boolean;
  options?: string[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  content: string;
  variables: PromptVariable[];
  version?: string;
  tags?: string[];
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  isPublic?: boolean;
}

export interface FillPromptOptions {
  strict?: boolean;
  trimWhitespace?: boolean;
  normalizeNewlines?: boolean;
}

export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private defaultOptions: FillPromptOptions = {
    strict: false,
    trimWhitespace: true,
    normalizeNewlines: true,
  };

  createTemplate(params: {
    name: string;
    description?: string;
    category?: string;
    content: string;
    variables?: PromptVariable[];
    version?: string;
    tags?: string[];
    createdBy?: string;
    isPublic?: boolean;
  }): PromptTemplate {
    const id = 'tpl_' + Math.random().toString(36).substring(2, 15);
    const now = Date.now();

    const variables = params.variables || this.extractVariables(params.content);

    const template: PromptTemplate = {
      id,
      name: params.name,
      description: params.description,
      category: params.category,
      content: params.content,
      variables,
      version: params.version || '1.0.0',
      tags: params.tags,
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy,
      isPublic: params.isPublic ?? false,
    };

    this.templates.set(id, template);
    return template;
  }

  getTemplate(id: string): PromptTemplate | undefined {
    return this.templates.get(id);
  }

  requireTemplate(id: string): PromptTemplate {
    const template = this.templates.get(id);
    if (!template) {
      throw new Error(`Prompt template ${id} not found`);
    }
    return template;
  }

  updateTemplate(id: string, updates: Partial<Omit<PromptTemplate, 'id' | 'createdAt'>>): PromptTemplate {
    const template = this.requireTemplate(id);
    Object.assign(template, updates);
    template.updatedAt = Date.now();
    return template;
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  listTemplates(params: {
    category?: string;
    tag?: string;
    createdBy?: string;
    isPublic?: boolean;
    page?: number;
    pageSize?: number;
  } = {}): {
    items: PromptTemplate[];
    total: number;
  } {
    let templates = Array.from(this.templates.values());

    if (params.category) {
      templates = templates.filter((t) => t.category === params.category);
    }

    if (params.tag) {
      templates = templates.filter((t) => t.tags?.includes(params.tag!));
    }

    if (params.createdBy) {
      templates = templates.filter((t) => t.createdBy === params.createdBy);
    }

    if (params.isPublic !== undefined) {
      templates = templates.filter((t) => t.isPublic === params.isPublic);
    }

    templates.sort((a, b) => b.updatedAt - a.updatedAt);

    const total = templates.length;
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const start = (page - 1) * pageSize;

    return {
      items: templates.slice(start, start + pageSize),
      total,
    };
  }

  fill(content: string, variables: Record<string, string | number | boolean>, options?: FillPromptOptions): string {
    const opts = { ...this.defaultOptions, ...options };
    let result = content;

    result = result.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, varName) => {
      const value = variables[varName];
      if (value === undefined || value === null) {
        if (opts.strict) {
          throw new Error(`Required variable "${varName}" is not provided`);
        }
        return match;
      }
      return String(value);
    });

    result = result.replace(/\{\{\s*(\w+)\s*\|\|\s*([^}]+)\s*\}\}/g, (match, varName, defaultValue) => {
      const value = variables[varName];
      if (value === undefined || value === null) {
        return defaultValue.trim();
      }
      return String(value);
    });

    if (opts.trimWhitespace) {
      result = result.replace(/[ \t]+/g, ' ').trim();
    }

    if (opts.normalizeNewlines) {
      result = result.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    }

    return result;
  }

  fillTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean>,
    options?: FillPromptOptions
  ): string {
    const template = this.requireTemplate(templateId);
    this.validateVariables(template.variables, variables);
    return this.fill(template.content, variables, options);
  }

  extractVariables(content: string): PromptVariable[] {
    const variableMap = new Map<string, PromptVariable>();

    const regex = /\{\{\s*(\w+)(?:\s*\|\|\s*([^}]+))?\s*\}\}/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      const name = match[1];
      if (!variableMap.has(name)) {
        variableMap.set(name, {
          name,
          type: 'string',
          required: match[2] === undefined,
          defaultValue: match[2],
        });
      }
    }

    return Array.from(variableMap.values());
  }

  validateVariables(
    schema: PromptVariable[],
    values: Record<string, string | number | boolean>
  ): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const variable of schema) {
      const value = values[variable.name];

      if (variable.required && (value === undefined || value === null)) {
        errors.push(`Required variable "${variable.name}" is missing`);
        continue;
      }

      if (value === undefined || value === null) {
        continue;
      }

      if (variable.type === 'number') {
        if (typeof value !== 'number' && isNaN(Number(value))) {
          errors.push(`Variable "${variable.name}" must be a number`);
        }
      }

      if (variable.type === 'boolean') {
        if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
          errors.push(`Variable "${variable.name}" must be a boolean`);
        }
      }

      if (variable.type === 'enum' && variable.options) {
        if (!variable.options.includes(String(value))) {
          errors.push(
            `Variable "${variable.name}" must be one of: ${variable.options.join(', ')}`
          );
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  copyTemplate(id: string, newName: string, createdBy?: string): PromptTemplate {
    const source = this.requireTemplate(id);
    return this.createTemplate({
      name: newName,
      description: source.description,
      category: source.category,
      content: source.content,
      variables: [...source.variables],
      tags: source.tags ? [...source.tags] : undefined,
      createdBy,
      isPublic: false,
    });
  }

  searchTemplates(keyword: string): PromptTemplate[] {
    const lower = keyword.toLowerCase();
    return Array.from(this.templates.values()).filter(
      (t) =>
        t.name.toLowerCase().includes(lower) ||
        (t.description && t.description.toLowerCase().includes(lower)) ||
        t.content.toLowerCase().includes(lower) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(lower))
    );
  }
}
