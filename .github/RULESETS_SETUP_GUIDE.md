# 🛡️ GitHub Repository Rulesets Setup Guide

## Overview
This guide explains how to set up comprehensive GitHub repository rulesets for **comfort-control-easehub**. Rulesets provide modern, flexible repository protection rules that replace traditional branch protection rules.

## 📋 Quick Setup Checklist

### ✅ **Phase 1: Basic Protection (Start Here)**
- [ ] Navigate to repository Settings
- [ ] Go to Rules → Rulesets
- [ ] Create "Main Branch Protection" ruleset
- [ ] Enable basic branch protection rules
- [ ] Test with a small PR

### ✅ **Phase 2: Enhanced Security**
- [ ] Enable security scanning in repository settings
- [ ] Set up required status checks
- [ ] Configure file path restrictions
- [ ] Add commit message patterns

### ✅ **Phase 3: Advanced Governance**
- [ ] Set up development branch rules
- [ ] Configure tag protection
- [ ] Enable signed commits requirement
- [ ] Set up bypass conditions

## 🎯 **Step-by-Step Implementation**

### **Step 1: Access Rulesets Settings**
1. Go to your repository: `https://github.com/nickotmazgin/comfort-control-easehub`
2. Click **Settings** tab
3. In left sidebar, click **Rules** → **Rulesets**
4. Click **New ruleset** → **New branch ruleset**

### **Step 2: Create Main Branch Protection Ruleset**

#### **Basic Information**
```
Ruleset Name: Main Branch Protection
Description: Comprehensive protection for production branch
Enforcement Status: Active
Target: Branch
```

#### **Target Configuration**
```
Included branches:
- main
- master (if applicable)

Excluded branches: (leave empty)
```

#### **Rules to Enable**

**🔒 Branch Protection Rules:**
- ☑️ **Restrict pushes** - Require pull requests
- ☑️ **Restrict deletions** - Prevent branch deletion
- ☑️ **Restrict force pushes** - Prevent history rewriting

**📝 Pull Request Rules:**
```
- Require pull request reviews: ✅ ON
- Required number of reviewers: 1
- Dismiss stale reviews: ✅ ON
- Require review from code owners: ✅ ON
- Require approval of most recent push: ✅ ON
```

**⚡ Status Check Rules:**
```
- Require status checks to pass: ✅ ON
- Require up-to-date branches: ✅ ON

Required status checks:
- quality-checks / validate-extension
- quality-checks / security-scan
- quality-checks / compliance-check
- quality-checks / build-test
```

**📁 File Path Restrictions:**
```
Restricted paths requiring additional review:
- .github/**
- SECURITY.md
- LICENSE
- metadata.json
- *.yml
- *.yaml
```

**✍️ Commit Rules:**
```
Commit message pattern:
^(feat|fix|docs|style|refactor|perf|test|chore|ci|build)(\(.+\))?: .{1,50}

Examples:
✅ feat: add new screenshot feature
✅ fix(ui): resolve button alignment issue  
✅ docs: update installation instructions
❌ fixed stuff
❌ WIP
```

**🏷️ Tag Rules:**
```
Tag name pattern:
^v\d+\.\d+\.\d+(-[a-zA-Z0-9]+)*$

Examples:
✅ v1.2.3
✅ v2.0.0-beta
✅ v1.5.1-rc.1
❌ version-1.2
❌ release-beta
```

### **Step 3: Configure Bypass Settings**

**Who can bypass rules:**
```
- Repository administrators: Always
- Specific users: (add trusted maintainers)
- Organization owners: Always (if applicable)
```

**Bypass conditions:**
```
- Emergency hotfixes: With reason
- Security patches: With approval
- Automated dependency updates: Never
```

### **Step 4: Create Development Branch Ruleset**

Create a second ruleset for development branches:

```
Ruleset Name: Development Branch Rules
Target branches: 
- dev*
- feature/*
- hotfix/*
- bugfix/*

Rules:
- Allow direct pushes (no PR required)
- Prevent force pushes to shared branches
- Basic commit message validation (minimum 10 characters)
- No file restrictions (more flexible)
```

### **Step 5: Enable Repository Security Features**

Go to **Settings** → **Security & analysis**:

#### **Enable All Security Features:**
- ☑️ **Dependency alerts** - Get notified about vulnerabilities
- ☑️ **Dependabot security updates** - Automatic security patches  
- ☑️ **Dependabot version updates** - Keep dependencies current
- ☑️ **Code scanning alerts** - Static analysis security scanning
- ☑️ **Secret scanning alerts** - Detect committed secrets

#### **Advanced Security (GitHub Pro/Teams):**
- ☑️ **Push protection** - Block pushes containing secrets
- ☑️ **Custom patterns** - Organization-specific secret patterns

### **Step 6: Configure Status Checks**

#### **Required GitHub Actions:**
Our quality-checks.yml workflow provides these status checks:
- `validate-extension` - Extension validation
- `security-scan` - Security vulnerability scanning  
- `compliance-check` - License and documentation compliance
- `code-quality` - Code metrics and analysis
- `build-test` - Package and build verification

#### **External Status Checks (Optional):**
- CodeClimate Quality - Code quality analysis
- Snyk Security - Dependency vulnerability scanning
- Codecov - Code coverage reporting

## 🧪 **Testing Your Rulesets**

### **Test Scenario 1: Protected Branch Push**
```bash
# This should be blocked
git checkout main
git commit -m "direct push test"
git push origin main
# Expected: ❌ Push blocked by ruleset
```

### **Test Scenario 2: Valid Pull Request**
```bash
# This should work
git checkout -b feature/test-rulesets
git commit -m "feat: test ruleset configuration"
git push origin feature/test-rulesets
# Create PR on GitHub
# Expected: ✅ PR allowed, checks run
```

### **Test Scenario 3: Invalid Commit Message**
```bash
# This should be blocked
git commit -m "fixed stuff"
git push origin feature/bad-commit
# Expected: ❌ Commit message doesn't match pattern
```

## 📊 **Monitoring and Maintenance**

### **Regular Tasks:**
- **Weekly:** Review security scan results
- **Monthly:** Update required status checks
- **Quarterly:** Review and update ruleset configurations
- **As needed:** Adjust bypass permissions

### **Metrics to Track:**
- Pull request merge rate
- Security scan findings
- Ruleset bypass frequency
- Build failure rate

## 🚨 **Emergency Procedures**

### **Hotfix Process:**
1. Create hotfix branch from main
2. Request emergency bypass (if needed)
3. Make minimal, focused changes
4. Get expedited review
5. Merge with admin override (if necessary)
6. Tag and deploy immediately
7. Follow up with post-mortem

### **Ruleset Issues:**
If rulesets block legitimate work:
1. **Immediate:** Use bypass with clear reason
2. **Short-term:** Adjust ruleset configuration
3. **Long-term:** Update processes to meet ruleset requirements

## 🔧 **Troubleshooting**

### **Common Issues:**

**Issue:** Status checks never complete
**Solution:** Verify GitHub Actions workflow is correct and has proper permissions

**Issue:** Contributors can't push to feature branches
**Solution:** Check development branch ruleset isn't too restrictive

**Issue:** Bypass permissions not working
**Solution:** Verify user has correct repository role (maintain/admin)

**Issue:** Commit messages keep being rejected
**Solution:** Share commit message examples with team

## 📚 **Additional Resources**

- [GitHub Rulesets Documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets)
- [GitHub Actions Security Best Practices](https://docs.github.com/en/actions/security-guides)
- [GNOME Extension Development Guidelines](https://gjs.guide/extensions/)
- [Semantic Versioning Specification](https://semver.org/)

---

**Next Steps:**
1. Commit these ruleset files to your repository
2. Follow the step-by-step implementation guide
3. Test thoroughly with small changes first
4. Gradually enable more restrictive rules
5. Train team members on new processes