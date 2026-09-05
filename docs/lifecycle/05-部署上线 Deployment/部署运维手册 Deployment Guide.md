# 部署运维手册 Deployment Guide

## 文档信息 Document Information

| 项目 Item | 内容 Content |
|---------|-------------|
| 文档版本 Document Version | v1.0.0 |
| 创建日期 Created Date | YYYY-MM-DD |
| 运维负责人 DevOps Engineer | |

---

## 目录 Table of Contents

1. [部署概述 Deployment Overview](#1-部署概述-deployment-overview)
2. [环境部署 Environment Deployment](#2-环境部署-environment-deployment)
3. [部署步骤 Deployment Steps](#3-部署步骤-deployment-steps)
4. [运维操作 Operations](#4-运维操作-operations)
5. [监控告警 Monitoring & Alerts](#5-监控告警-monitoring--alerts)

---

## 1. 部署概述 Deployment Overview

### 1.1 部署架构 Deployment Architecture

```
[开发环境] → [测试环境] → [预发布环境] → [生产环境]
   Dev           Test            Staging           Production
```

### 1.2 环境配置 Environment Configuration

| 环境 Environment | 用途 Usage | 服务器配置 Server Config | 访问地址 URL |
|----------------|----------|-------------------------|--------------|
| 开发环境 Dev | 日常开发 | 2C4G × 1 | dev.example.com |
| 测试环境 Test | 功能测试 | 4C8G × 2 | test.example.com |
| 预发布 Staging | 上线前验证 | 生产配置 | staging.example.com |
| 生产环境 Production | 正式运行 | 8C16G × 3+ | example.com |

---

## 2. 环境部署 Environment Deployment

### 2.1 基础设施准备 Infrastructure Setup

#### 服务器要求 Server Requirements

| 组件 Component | 最低配置 Min | 推荐配置 Recommended |
|--------------|------------|-------------------|
| 应用服务器 App Server | 2C4G | 4C8G+ |
| 数据库服务器 DB Server | 4C8G | 8C16G+ |
| 缓存服务器 Cache Server | 2C4G | 4C8G |

#### 系统依赖 System Dependencies

| 依赖 Dependency | 版本 Version |
|--------------|-------------|
| 操作系统 OS | Linux (CentOS 7+ / Ubuntu 20.04+) |
| Java JDK | 17 LTS |
| Node.js | 18.x |
| MySQL | 8.0+ |
| Redis | 7.x |
| Nginx | 1.20+ |

### 2.2 Docker部署 Docker Deployment

#### Docker Compose配置

```yaml
version: '3.8'
services:
  app:
    image: your-app:latest
    ports:
      - "8080:8080"
    environment:
      - SPRING_PROFILES_ACTIVE=production
      - DB_HOST=mysql
      - REDIS_HOST=redis
    depends_on:
      - mysql
      - redis

  mysql:
    image: mysql:8.0
    environment:
      - MYSQL_ROOT_PASSWORD=${DB_PASSWORD}
      - MYSQL_DATABASE=project_db
    volumes:
      - mysql_data:/var/lib/mysql

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

volumes:
  mysql_data:
  redis_data:
```

### 2.3 Kubernetes部署 Kubernetes Deployment

#### 命名空间 Namespace

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: production
```

#### 部署配置 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-deployment
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: myapp
  template:
    metadata:
      labels:
        app: myapp
    spec:
      containers:
      - name: myapp
        image: your-app:v1.0.0
        ports:
        - containerPort: 8080
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: SPRING_PROFILES_ACTIVE
          value: "production"
---
apiVersion: v1
kind: Service
metadata:
  name: app-service
  namespace: production
spec:
  selector:
    app: myapp
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
```

---

## 3. 部署步骤 Deployment Steps

### 3.1 发布流程 Release Process

```
1. 代码审查 Code Review
      ↓
2. 运行测试 Run Tests
      ↓
3. 构建镜像 Build Image
      ↓
4. 推送镜像 Push Image
      ↓
5. 更新部署 Update Deployment
      ↓
6. 健康检查 Health Check
      ↓
7. 流量切换 Traffic Switch
```

### 3.2 发布检查清单 Release Checklist

| 检查项 Check Item | 状态 Status |
|-----------------|-----------|
| 代码审查通过 Code Review | □ |
| 单元测试通过 Unit Tests | □ |
| 集成测试通过 Integration Tests | □ |
| 性能测试通过 Performance Tests | □ |
| 安全扫描通过 Security Scan | □ |
| 数据库迁移准备 DB Migration | □ |
| 回滚方案准备 Rollback Plan | □ |

### 3.3 回滚步骤 Rollback Steps

```bash
# Docker回滚
docker-compose down
docker-compose up -d --scale app=3

# Kubernetes回滚
kubectl rollout undo deployment/app-deployment -n production

# 验证回滚
kubectl get pods -n production
```

---

## 4. 运维操作 Operations

### 4.1 日常操作 Daily Operations

#### 查看日志 View Logs

```bash
# Docker环境
docker logs -f app-container

# Kubernetes环境
kubectl logs -f deployment/app-deployment -n production

# 查看最近100行
kubectl logs --tail=100 deployment/app-deployment -n production
```

#### 重启服务 Restart Service

```bash
# Docker重启
docker-compose restart app

# Kubernetes重启
kubectl rollout restart deployment/app-deployment -n production
```

#### 扩缩容 Scaling

```bash
# 扩容到5个实例
kubectl scale deployment/app-deployment --replicas=5 -n production

# 自动扩缩容
kubectl autoscale deployment/app-deployment --min=3 --max=10 --cpu-percent=70
```

### 4.2 数据库操作 Database Operations

#### 备份 Backup

```bash
# MySQL备份
mysqldump -u root -p project_db > backup_$(date +%Y%m%d).sql

# 恢复
mysql -u root -p project_db < backup_20240101.sql
```

#### 数据库迁移 Migration

```bash
# 执行迁移脚本
mysql -u root -p project_db < migrations/V1.0__init.sql
```

### 4.3 缓存操作 Cache Operations

```bash
# 清空所有缓存
redis-cli FLUSHALL

# 清空特定key
redis-cli DEL "user:1001"

# 查看key
redis-cli GET "user:1001"
```

---

## 5. 监控告警 Monitoring & Alerts

### 5.1 监控指标 Monitoring Metrics

| 类别 Category | 指标 Metric | 阈值 Threshold |
|-------------|-----------|---------------|
| 应用 Application | CPU使用率 | > 80% 告警 |
| 应用 Application | 内存使用率 | > 85% 告警 |
| 应用 Application | 响应时间 | > 1s 告警 |
| 应用 Application | 错误率 | > 1% 告警 |
| 数据库 Database | 连接数 | > 80% 告警 |
| 数据库 Database | 慢查询 | > 1s 告警 |

### 5.2 告警配置 Alert Configuration

#### Prometheus告警规则

```yaml
groups:
- name: app_alerts
  rules:
  - alert: HighCPUUsage
    expr: process_cpu_usage > 0.8
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High CPU usage detected"
      description: "CPU usage is {{ $value }}%"

  - alert: HighMemoryUsage
    expr: process_memory_usage > 0.85
    for: 5m
    labels:
      severity: warning
    annotations:
      summary: "High memory usage detected"

  - alert: HighErrorRate
    expr: rate(errors_total[5m]) > 0.01
    for: 5m
    labels:
      severity: critical
    annotations:
      summary: "High error rate detected"
```

### 5.3 告警通知 Alert Notification

| 告警级别 Severity | 通知方式 Notification |
|----------------|-------------------|
| 严重 Critical | 短信 + 电话 + 邮件 |
| 警告 Warning | 邮件 + 即时通讯 |
| 信息 Info | 邮件 |

---

## 附录 Appendix

### 附录A: 常用命令 Common Commands

```bash
# 查看服务状态
systemctl status nginx

# 重启服务
systemctl restart nginx

# 查看端口占用
netstat -tulnp | grep 8080

# 查看磁盘空间
df -h

# 查看系统负载
top
htop
```

### 附录B: 故障排查 Troubleshooting

| 问题 Issue | 可能原因 Possible Cause | 解决方案 Solution |
|----------|---------------------|-----------------|
| 服务无法访问 | 服务未启动 | 检查服务状态并启动 |
| 响应慢 | 资源不足 | 检查CPU/内存/磁盘 |
| 数据库连接失败 | 数据库未启动 | 检查数据库服务 |
| 502错误 | 后端服务异常 | 查看后端日志 |

---

## 审批与签署 Approvals

| 角色 Role | 姓名 Name | 签名 Signature | 日期 Date |
|----------|---------|--------------|---------|
| 运维负责人 DevOps Lead | | | |

---

**文档结束 End of Document**
