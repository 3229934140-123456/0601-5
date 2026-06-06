export type TemplateStatus = 'draft' | 'published' | 'archived';

export type VariableType = 'string' | 'number' | 'boolean' | 'enum' | 'text' | 'date' | 'list';

export interface PromptVariable {
  name: string;
  type: VariableType;
  label?: string;
  description?: string;
  required?: boolean;
  defaultValue?: string | number | boolean | string[];
  options?: string[];
  min?: number;
  max?: number;
  pattern?: string;
  placeholder?: string;
}

export interface ValidationError {
  field: string;
  message: string;
  code: 'required' | 'type_mismatch' | 'invalid_option' | 'out_of_range' | 'pattern_mismatch' | 'unknown_variable';
  value?: unknown;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings?: string[];
}

export interface PromptTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  status: TemplateStatus;
  content: string;
  variables: PromptVariable[];
  version: string;
  versionHistory: {
    version: string;
    content: string;
    variables: PromptVariable[];
    updatedAt: number;
    updatedBy?: string;
    note?: string;
  }[];
  tags: string[];
  createdAt: number;
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  isPublic: boolean;
  useCount: number;
  metadata?: Record<string, unknown>;
}

export interface FillPromptOptions {
  strict?: boolean;
  trimWhitespace?: boolean;
  normalizeNewlines?: boolean;
  validateVariables?: boolean;
  returnValidation?: boolean;
}

export interface FillResult {
  content: string;
  filledVariables: string[];
  missingVariables: string[];
  variables: Record<string, string | number | boolean | string[]>;
  validation?: ValidationResult;
}

export class PromptManager {
  private templates: Map<string, PromptTemplate> = new Map();
  private defaultOptions: FillPromptOptions = {
    strict: false,
    trimWhitespace: true,
    normalizeNewlines: true,
    validateVariables: false,
    returnValidation: false,
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
    status?: TemplateStatus;
    metadata?: Record<string, unknown>;
  }): PromptTemplate {
    const id = 'tpl_' + Math.random().toString(36).substring(2, 15);
    const now = Date.now();

    const variables = params.variables || this.extractVariables(params.content);

    const template: PromptTemplate = {
      id,
      name: params.name,
      description: params.description,
      category: params.category,
      status: params.status || 'draft',
      content: params.content,
      variables,
      version: params.version || '1.0.0',
      versionHistory: [
        {
          version: params.version || '1.0.0',
          content: params.content,
          variables: [...variables],
          updatedAt: now,
          updatedBy: params.createdBy,
        },
      ],
      tags: params.tags || [],
      createdAt: now,
      updatedAt: now,
      createdBy: params.createdBy,
      updatedBy: params.createdBy,
      isPublic: params.isPublic ?? false,
      useCount: 0,
      metadata: params.metadata,
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

  updateTemplate(
    id: string,
    updates: Partial<Omit<PromptTemplate, 'id' | 'createdAt' | 'versionHistory' | 'useCount'>> & {
      versionNote?: string;
      bumpVersion?: 'major' | 'minor' | 'patch' | false;
    }
  ): PromptTemplate {
    const template = this.requireTemplate(id);
    const now = Date.now();

    const { bumpVersion, versionNote, ...fieldUpdates } = updates;

    let newVersion = template.version;
    if (bumpVersion && bumpVersion !== false) {
      newVersion = this.bumpVersion(template.version, bumpVersion);
    } else if (fieldUpdates.version && fieldUpdates.version !== template.version) {
      newVersion = fieldUpdates.version;
    }

    if (newVersion !== template.version || fieldUpdates.content || fieldUpdates.variables) {
      template.versionHistory.unshift({
        version: newVersion,
        content: fieldUpdates.content || template.content,
        variables: fieldUpdates.variables ? [...fieldUpdates.variables] : [...template.variables],
        updatedAt: now,
        updatedBy: fieldUpdates.updatedBy || template.updatedBy,
        note: versionNote,
      });
      template.version = newVersion;
    }

    Object.assign(template, fieldUpdates);
    template.updatedAt = now;

    if (fieldUpdates.content && !fieldUpdates.variables) {
      template.variables = this.extractVariables(fieldUpdates.content);
    }

    return template;
  }

  deleteTemplate(id: string): boolean {
    return this.templates.delete(id);
  }

  publishTemplate(id: string, note?: string, updatedBy?: string): PromptTemplate {
    return this.updateTemplate(id, {
      status: 'published',
      versionNote: note,
      updatedBy,
    });
  }

  archiveTemplate(id: string): PromptTemplate {
    return this.updateTemplate(id, { status: 'archived' });
  }

  listTemplates(params: {
    category?: string;
    tag?: string;
    status?: TemplateStatus;
    createdBy?: string;
    isPublic?: boolean;
    keyword?: string;
    page?: number;
    pageSize?: number;
    sortBy?: 'updatedAt' | 'createdAt' | 'name' | 'useCount';
    sortOrder?: 'asc' | 'desc';
  } = {}): {
    items: PromptTemplate[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
  } {
    let templates = Array.from(this.templates.values());

    if (params.category) {
      templates = templates.filter((t) => t.category === params.category);
    }

    if (params.tag) {
      templates = templates.filter((t) => t.tags.includes(params.tag!));
    }

    if (params.status) {
      templates = templates.filter((t) => t.status === params.status);
    }

    if (params.createdBy) {
      templates = templates.filter((t) => t.createdBy === params.createdBy);
    }

    if (params.isPublic !== undefined) {
      templates = templates.filter((t) => t.isPublic === params.isPublic);
    }

    if (params.keyword) {
      templates = this.searchTemplates(templates, params.keyword);
    }

    const sortBy = params.sortBy || 'updatedAt';
    const sortOrder = params.sortOrder || 'desc';
    templates.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'name':
          comparison = a.name.localeCompare(b.name);
          break;
        case 'createdAt':
          comparison = a.createdAt - b.createdAt;
          break;
        case 'useCount':
          comparison = a.useCount - b.useCount;
          break;
        case 'updatedAt':
        default:
          comparison = a.updatedAt - b.updatedAt;
      }
      return sortOrder === 'desc' ? -comparison : comparison;
    });

    const total = templates.length;
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const start = (page - 1) * pageSize;
    const items = templates.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total,
    };
  }

  private searchTemplates(templates: PromptTemplate[], keyword: string): PromptTemplate[] {
    const lower = keyword.toLowerCase();
    return templates.filter((t) => {
      if (t.name.toLowerCase().includes(lower)) return true;
      if (t.description && t.description.toLowerCase().includes(lower)) return true;
      if (t.content.toLowerCase().includes(lower)) return true;
      if (t.tags.some((tag) => tag.toLowerCase().includes(lower))) return true;
      if (t.category && t.category.toLowerCase().includes(lower)) return true;
      return false;
    });
  }

  search(keyword: string, limit?: number): PromptTemplate[] {
    const result = this.listTemplates({ keyword, pageSize: limit || 50 });
    return result.items;
  }

  fill(
    content: string,
    variables: Record<string, string | number | boolean | string[]>,
    options?: FillPromptOptions
  ): FillResult {
    const opts = { ...this.defaultOptions, ...options };
    const filledVariables: string[] = [];
    const missingVariables: string[] = [];
    let result = content;

    const allVarsInTemplate = this.extractVariableNames(content);

    result = result.replace(/\{\{\s*(\w+)(?:\s*\|\|\s*([^}]+))?\s*\}\}/g, (match, varName, defaultValue) => {
      const value = variables[varName];

      if (value === undefined || value === null || value === '') {
        if (defaultValue !== undefined) {
          filledVariables.push(varName);
          return defaultValue.trim();
        }

        if (opts.strict) {
          missingVariables.push(varName);
          return match;
        }

        missingVariables.push(varName);
        return match;
      }

      filledVariables.push(varName);

      if (Array.isArray(value)) {
        return value.join(', ');
      }

      return String(value);
    });

    if (opts.strict && missingVariables.length > 0) {
      const errors: ValidationError[] = missingVariables.map((name) => ({
        field: name,
        message: `Required variable "${name}" is not provided`,
        code: 'required' as const,
        value: variables[name],
      }));

      if (opts.returnValidation) {
        return {
          content: result,
          filledVariables,
          missingVariables,
          variables,
          validation: { valid: false, errors },
        };
      }

      throw {
        name: 'PromptFillError',
        message: `Missing required variables: ${missingVariables.join(', ')}`,
        errors,
        missingVariables,
      };
    }

    if (opts.trimWhitespace) {
      result = result.replace(/[ \t]+/g, ' ').trim();
    }

    if (opts.normalizeNewlines) {
      result = result.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n');
    }

    const fillResult: FillResult = {
      content: result,
      filledVariables: [...new Set(filledVariables)],
      missingVariables: [...new Set(missingVariables)],
      variables,
    };

    if (opts.returnValidation || opts.validateVariables) {
      const extractedVars = this.extractVariables(content);
      const validation = this.validateVariables(extractedVars, variables);
      fillResult.validation = validation;
    }

    return fillResult;
  }

  fillTemplate(
    templateId: string,
    variables: Record<string, string | number | boolean | string[]>,
    options?: FillPromptOptions
  ): FillResult {
    const template = this.requireTemplate(templateId);

    const opts = { ...this.defaultOptions, validateVariables: true, ...options };

    const result = this.fill(template.content, variables, opts);

    template.useCount++;

    return result;
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

  extractVariableNames(content: string): string[] {
    const names = new Set<string>();
    const regex = /\{\{\s*(\w+)(?:\s*\|\|\s*[^}]+)?\s*\}\}/g;
    let match;

    while ((match = regex.exec(content)) !== null) {
      names.add(match[1]);
    }

    return Array.from(names);
  }

  validateVariables(
    schema: PromptVariable[],
    values: Record<string, string | number | boolean | string[] | undefined>
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: string[] = [];

    for (const variable of schema) {
      const value = values[variable.name];

      if (variable.required && (value === undefined || value === null || value === '')) {
        errors.push({
          field: variable.name,
          message: `Variable "${variable.name}" is required`,
          code: 'required',
          value,
        });
        continue;
      }

      if (value === undefined || value === null || value === '') {
        continue;
      }

      switch (variable.type) {
        case 'number': {
          const numValue = typeof value === 'number' ? value : Number(value);
          if (isNaN(numValue)) {
            errors.push({
              field: variable.name,
              message: `Variable "${variable.name}" must be a number`,
              code: 'type_mismatch',
              value,
            });
          } else {
            if (variable.min !== undefined && numValue < variable.min) {
              errors.push({
                field: variable.name,
                message: `Variable "${variable.name}" must be >= ${variable.min}`,
                code: 'out_of_range',
                value,
              });
            }
            if (variable.max !== undefined && numValue > variable.max) {
              errors.push({
                field: variable.name,
                message: `Variable "${variable.name}" must be <= ${variable.max}`,
                code: 'out_of_range',
                value,
              });
            }
          }
          break;
        }

        case 'boolean': {
          if (typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
            errors.push({
              field: variable.name,
              message: `Variable "${variable.name}" must be a boolean`,
              code: 'type_mismatch',
              value,
            });
          }
          break;
        }

        case 'enum': {
          if (variable.options && !variable.options.includes(String(value))) {
            errors.push({
              field: variable.name,
              message: `Variable "${variable.name}" must be one of: ${variable.options.join(', ')}`,
              code: 'invalid_option',
              value,
            });
          }
          break;
        }

        case 'string':
        case 'text': {
          if (variable.pattern) {
            const regex = new RegExp(variable.pattern);
            if (!regex.test(String(value))) {
              errors.push({
                field: variable.name,
                message: `Variable "${variable.name}" does not match pattern`,
                code: 'pattern_mismatch',
                value,
              });
            }
          }
          break;
        }

        case 'list': {
          if (!Array.isArray(value) && typeof value !== 'string') {
            errors.push({
              field: variable.name,
              message: `Variable "${variable.name}" must be an array or string`,
              code: 'type_mismatch',
              value,
            });
          }
          break;
        }
      }
    }

    const schemaNames = new Set(schema.map((v) => v.name));
    for (const key of Object.keys(values)) {
      if (!schemaNames.has(key)) {
        warnings.push(`Unknown variable "${key}" provided`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  validateTemplateFill(
    templateId: string,
    variables: Record<string, string | number | boolean | string[] | undefined>
  ): ValidationResult {
    const template = this.requireTemplate(templateId);
    return this.validateVariables(template.variables, variables);
  }

  copyTemplate(id: string, newName: string, createdBy?: string): PromptTemplate {
    const source = this.requireTemplate(id);
    return this.createTemplate({
      name: newName,
      description: source.description,
      category: source.category,
      content: source.content,
      variables: [...source.variables],
      tags: [...source.tags],
      createdBy,
      isPublic: false,
      status: 'draft',
    });
  }

  getVersionHistory(id: string): PromptTemplate['versionHistory'] {
    const template = this.requireTemplate(id);
    return template.versionHistory;
  }

  restoreVersion(id: string, version: string, note?: string, updatedBy?: string): PromptTemplate {
    const template = this.requireTemplate(id);
    const versionEntry = template.versionHistory.find((v) => v.version === version);

    if (!versionEntry) {
      throw new Error(`Version ${version} not found for template ${id}`);
    }

    return this.updateTemplate(id, {
      content: versionEntry.content,
      variables: [...versionEntry.variables],
      versionNote: note || `Restored from version ${version}`,
      bumpVersion: 'patch',
      updatedBy,
    });
  }

  getCategories(): string[] {
    const categories = new Set<string>();
    for (const template of this.templates.values()) {
      if (template.category) {
        categories.add(template.category);
      }
    }
    return Array.from(categories).sort();
  }

  getAllTags(): { tag: string; count: number }[] {
    const tagCounts = new Map<string, number>();
    for (const template of this.templates.values()) {
      for (const tag of template.tags) {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
      }
    }
    return Array.from(tagCounts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  getPopularTemplates(limit: number = 10): PromptTemplate[] {
    return Array.from(this.templates.values())
      .filter((t) => t.status === 'published')
      .sort((a, b) => b.useCount - a.useCount)
      .slice(0, limit);
  }

  private bumpVersion(version: string, type: 'major' | 'minor' | 'patch'): string {
    const parts = version.split('.').map((v) => parseInt(v, 10) || 0);
    while (parts.length < 3) parts.push(0);

    const [major, minor, patch] = parts;

    switch (type) {
      case 'major':
        return `${major + 1}.0.0`;
      case 'minor':
        return `${major}.${minor + 1}.0`;
      case 'patch':
      default:
        return `${major}.${minor}.${patch + 1}`;
    }
  }
}
