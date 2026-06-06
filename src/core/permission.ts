import { PermissionContext, OperationType, ModuleType } from '../types';

export class PermissionManager {
  private permissions: Map<string, Set<string>> = new Map();
  private rolePermissions: Map<string, Set<string>> = new Map();

  constructor() {
    this.initDefaultRoles();
  }

  private initDefaultRoles(): void {
    const adminOps = this.getAllOperations();
    this.rolePermissions.set('admin', new Set(adminOps));

    const userOps = [
      'session.create',
      'session.chat',
      'session.history',
      'session.clear',
      'prompt.fill',
      'prompt.template.list',
      'prompt.template.get',
      'document.summarize',
      'document.extractKeyPoints',
      'document.classify',
      'document.sensitiveCheck',
      'image.describe',
      'image.compare',
      'task.submit',
      'task.status',
      'task.result',
      'task.list',
      'task.cancel',
      'audit.log.get',
      'config.get',
    ];
    this.rolePermissions.set('user', new Set(userOps));

    const viewerOps = [
      'session.history',
      'prompt.template.list',
      'prompt.template.get',
      'task.status',
      'task.result',
      'task.list',
      'audit.log.get',
      'config.get',
      'config.list',
    ];
    this.rolePermissions.set('viewer', new Set(viewerOps));
  }

  private getAllOperations(): string[] {
    return [
      'session.create',
      'session.chat',
      'session.history',
      'session.clear',
      'prompt.fill',
      'prompt.template.list',
      'prompt.template.create',
      'prompt.template.get',
      'prompt.template.update',
      'prompt.template.delete',
      'document.summarize',
      'document.extractKeyPoints',
      'document.classify',
      'document.sensitiveCheck',
      'image.describe',
      'image.compare',
      'task.submit',
      'task.status',
      'task.result',
      'task.list',
      'task.cancel',
      'audit.log.list',
      'audit.log.get',
      'config.get',
      'config.set',
      'config.list',
      'usage.stats',
    ];
  }

  setRolePermissions(role: string, operations: string[]): void {
    this.rolePermissions.set(role, new Set(operations));
  }

  setUserPermissions(userId: string, operations: string[]): void {
    this.permissions.set(userId, new Set(operations));
  }

  addUserPermission(userId: string, operation: string): void {
    if (!this.permissions.has(userId)) {
      this.permissions.set(userId, new Set());
    }
    this.permissions.get(userId)!.add(operation);
  }

  removeUserPermission(userId: string, operation: string): void {
    const userPerms = this.permissions.get(userId);
    if (userPerms) {
      userPerms.delete(operation);
    }
  }

  check(context: PermissionContext, operation: OperationType): boolean {
    const userPerms = this.permissions.get(context.userId);
    if (userPerms && userPerms.has(operation)) {
      return true;
    }

    if (userPerms && userPerms.has('*')) {
      return true;
    }

    if (context.permissions) {
      if (context.permissions.includes('*') || context.permissions.includes(operation)) {
        return true;
      }
    }

    if (context.role) {
      const rolePerms = this.rolePermissions.get(context.role);
      if (rolePerms && (rolePerms.has(operation) || rolePerms.has('*'))) {
        return true;
      }
    }

    return false;
  }

  require(context: PermissionContext, operation: OperationType): void {
    if (!this.check(context, operation)) {
      throw new Error(
        `Permission denied: user ${context.userId} cannot perform ${operation}`
      );
    }
  }

  checkModule(context: PermissionContext, module: ModuleType): boolean {
    const modulePrefix = `${module}.`;
    const allOps = this.getAllOperations();
    const moduleOps = allOps.filter((op) => op.startsWith(modulePrefix));

    for (const op of moduleOps) {
      if (this.check(context, op as OperationType)) {
        return true;
      }
    }

    return false;
  }
}
