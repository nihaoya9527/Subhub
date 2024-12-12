import { DEFAULT_RULES, ROUTING_ORDER, sortRouting, parseRules } from './rules.js';

// 生成配置处理
async function handleGenerateConfig(request, env) {
  try {
    // 检查密码
    const data = await request.json();
    if (!data.password || data.password !== env.TEMPLATE_PASSWORD) {
      return new Response(JSON.stringify({
        success: false,
        message: '密码错误或未提供密码'
      }), {
        headers: { 'content-type': 'application/json' },
        status: 403
      });
    }

    // 检查 KV 绑定
    if (!env) {
      console.error('env object is undefined');
      return new Response(JSON.stringify({
        success: false,
        message: 'Worker 环境变量未正确配置'
      }), {
        headers: { 'content-type': 'application/json' },
        status: 500
      });
    }

    if (!env.TEMPLATE_CONFIG) {
      console.error('TEMPLATE_CONFIG binding is missing');
      console.log('Available bindings:', Object.keys(env));
      return new Response(JSON.stringify({
        success: false,
        message: 'KV 存储未正确绑定'
      }), {
        headers: { 'content-type': 'application/json' },
        status: 500
      });
    }

    const { password, ...configData } = data;
    console.log('Received data:', configData);

    if (!configData.templateName) {
      return new Response(JSON.stringify({
        success: false,
        message: '模板名称不能为空'
      }), {
        headers: {
          'content-type': 'application/json',
        },
        status: 400
      });
    }

    const template = generateTemplate(configData);
    
    const templateId = crypto.randomUUID();
    const templateInfo = {
      name: configData.templateName,
      content: template,
      createTime: new Date().toISOString()
    };
    
    // 使用 TextEncoder 确保正确的 UTF-8 编码
    const encoder = new TextEncoder();
    const encodedContent = encoder.encode(JSON.stringify(templateInfo));
    
    await env.TEMPLATE_CONFIG.put(templateId, encodedContent, {
      expirationTtl: undefined,
      metadata: { encoding: 'utf-8' }
    });
    
    return new Response(JSON.stringify({
      success: true,
      templateId,
      url: `/peizhi/template/${templateId}`
    }), {
      headers: {
        'content-type': 'application/json',
      }
    });
  } catch (error) {
    console.error('Generate config error:', error);
    return new Response(JSON.stringify({
      success: false,
      message: `生成配置失败: ${error.message}`,
      debug: {
        hasEnv: !!env,
        hasTemplateConfig: !!env?.TEMPLATE_CONFIG,
        availableBindings: env ? Object.keys(env) : []
      }
    }), {
      headers: { 'content-type': 'application/json' },
      status: 500
    });
  }
}

// 获取模板处理
async function handleGetTemplate(request, url, env) {
  if (!env || !env.TEMPLATE_CONFIG) {
    return new Response(JSON.stringify({
      success: false,
      message: 'KV storage not configured'
    }), { 
      status: 500,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });
  }

  const templateId = url.pathname.split('/')[3];
  const encodedContent = await env.TEMPLATE_CONFIG.get(templateId, 'arrayBuffer');
  
  if (!encodedContent) {
    return new Response(JSON.stringify({
      success: false,
      message: 'Template not found'
    }), { 
      status: 404,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });
  }

  // 使用 TextDecoder 解码
  const decoder = new TextDecoder('utf-8');
  const templateInfoStr = decoder.decode(encodedContent);
  const templateInfo = JSON.parse(templateInfoStr);
  
  return new Response(templateInfo.content, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-template-name': templateInfo.name,
      'x-template-create-time': templateInfo.createTime,
      'access-control-allow-origin': '*'
    },
  });
}

// 添加获取模板列表的功能
async function handleListTemplates(request, env) {
  if (!env || !env.TEMPLATE_CONFIG) {
    return new Response('KV storage not configured', { status: 500 });
  }

  const { keys } = await env.TEMPLATE_CONFIG.list();
  const templates = [];
  const decoder = new TextDecoder('utf-8');
  
  for (const key of keys) {
    const encodedContent = await env.TEMPLATE_CONFIG.get(key.name, 'arrayBuffer');
    const templateInfoStr = decoder.decode(encodedContent);
    const templateInfo = JSON.parse(templateInfoStr);
    templates.push({
      id: key.name,
      name: templateInfo.name,
      createTime: templateInfo.createTime
    });
  }
  
  return new Response(JSON.stringify(templates), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type'
    },
  });
}

// 添加删除模板的处理函数
async function handleDeleteTemplate(request, url, env) {
  try {
    // 检查密码
    const { password } = await request.json();
    if (!password || password !== env.TEMPLATE_PASSWORD) {
      return new Response(JSON.stringify({
        success: false,
        message: '密码错误或未提供密码'
      }), {
        headers: { 'content-type': 'application/json' },
        status: 403
      });
    }

    if (!env || !env.TEMPLATE_CONFIG) {
      return new Response('KV storage not configured', { 
        status: 500,
        headers: { 'content-type': 'application/json' }
      });
    }

    const templateId = url.pathname.split('/')[4];
    if (!templateId) {
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Invalid template ID' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    await env.TEMPLATE_CONFIG.delete(templateId);
    
    return new Response(JSON.stringify({ 
      success: true,
      message: 'Template deleted successfully'
    }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    console.error('Delete template error:', error);
    return new Response(JSON.stringify({ 
      success: false,
      message: 'Failed to delete template'
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}

// 生成配置模板
function generateTemplate(config) {
  const { rules, proxyGroups, routing } = config;
  let template = '';
  
  // 1. 生成规则部分
  template += rules.map(rule => 
    `ruleset=${rule.name},${rule.url}`
  ).join('\n') + '\n\n';
  
  // 2. 生成节点分组部分
  const processedGroups = new Set();
  
  template += proxyGroups.map(group => {
    if (group.name === '🚀 节点选择' && processedGroups.has(group.name)) {
      return '';
    }
    processedGroups.add(group.name);
    
    const type = group.type === 'auto' ? 'url-test' : 'select';
    
    if (group.isDefault) {
      const otherGroups = proxyGroups
        .filter(g => !g.isDefault)
        .map(g => `[]${g.name}`)
        .join('`');
      return `custom_proxy_group=${group.name}\`${type}\`${otherGroups}\`[]DIRECT`;
    }
    
    // 生成过滤规则
    let filter;
    if (group.filterType === 'regex') {
      filter = `(${group.keywords})`;
    } else if (group.filterType === 'inverse') {
      filter = `^(?!.*(${group.keywords})).*$`;
    } else if (group.filterType === 'both') {
      // 组合模式：反则在前，正则在后
      const [excludeKeywords, includeKeywords] = group.keywords.split(';;');
      filter = `^(?!.*(${excludeKeywords})).*$(${includeKeywords})`;
    }
    
    let groupStr = `custom_proxy_group=${group.name}\`${type}`;
    
    if (type === 'url-test') {
      groupStr += `\`${filter}\`http://www.gstatic.com/generate_204\`300,,50`;
    } else {
      groupStr += `\`${filter}`;
    }
    
    return groupStr;
  }).filter(Boolean).join('\n') + '\n\n';
  
  // 3. 生成分流部分
  const sortedRouting = sortRouting(routing);
  const proxyGroupsStr = proxyGroups.map(g => `[]${g.name}`).join('`');
  
  template += sortedRouting.map(route => {
    if (proxyGroups.some(group => group.name === route.name)) {
        return '';
    }
    
    if (route.isReject) {
        return `custom_proxy_group=${route.name}\`select\`[]REJECT\`[]DIRECT`;
    }
    return `custom_proxy_group=${route.name}\`select\`${proxyGroupsStr}\`[]DIRECT`;
  }).filter(Boolean).join('\n');
  
  return template;
}

// 生成 HTML
function generateTemplateManagerHTML() {
  return `
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>配置生成器</title>
  <script src="https://unpkg.com/react@17/umd/react.production.min.js"></script>
  <script src="https://unpkg.com/react-dom@17/umd/react-dom.production.min.js"></script>
  <script src="https://unpkg.com/babel-standalone@6/babel.min.js"></script>
  <link href="https://unpkg.com/tailwindcss@2/dist/tailwind.min.css" rel="stylesheet">
  <style>
    .steps {
      display: flex;
      gap: 1rem;
      margin-bottom: 2rem;
    }
    .step {
      padding: 0.5rem 1rem;
      border: 1px solid #ccc;
      border-radius: 0.25rem;
      opacity: 0.5;
    }
    .step.active {
      opacity: 1;
      background-color: #e5e7eb;
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="text/babel">
    ${generateReactComponents()}
  </script>
</body>
</html>
  `;
}

// 生成 React 组件代码
function generateReactComponents() {
  return `
    // 传递所有必要的配置到前端
    const DEFAULT_RULES = ${JSON.stringify(DEFAULT_RULES)};
    const parseRules = ${parseRules.toString()};
    const ROUTING_ORDER = ${JSON.stringify(ROUTING_ORDER)};
    const sortRouting = ${sortRouting.toString()};

    // 添加 TemplateListSection 组件
    function TemplateListSection({ onNew }) {
      const [templates, setTemplates] = React.useState([]);
      const [loading, setLoading] = React.useState(true);
      const [error, setError] = React.useState(null);

      React.useEffect(() => {
        fetchTemplates();
      }, []);

      const fetchTemplates = async () => {
        setLoading(true);
        setError(null);
        try {
          const response = await fetch('/peizhi/api/templates');
          if (!response.ok) throw new Error('Failed to load templates');
          const data = await response.json();
          setTemplates(data.sort((a, b) => 
            new Date(b.createTime) - new Date(a.createTime)
          ));
        } catch (err) {
          console.error('Load templates error:', err);
          setError('加载失败，请稍后重试');
        } finally {
          setLoading(false);
        }
      };

      const handleDelete = async (id, name) => {
        const password = prompt('请输入管理密码以删除模板：');
        if (!password) return;

        if (!confirm(\`确定要删除模板 "\${name}" 吗？\`)) return;

        try {
          const response = await fetch(\`/peizhi/api/templates/\${id}\`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ password })
          });
          
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || 'Delete failed');
          }
          
          const result = await response.json();
          if (result.success) {
            setTemplates(prev => prev.filter(t => t.id !== id));
          } else {
            throw new Error(result.message || 'Delete failed');
          }
        } catch (err) {
          console.error('Delete error:', err);
          alert(err.message || '删除失败，请稍后重试');
        }
      };

      const copyToClipboard = async (id) => {
        const url = \`\${window.location.origin}/peizhi/template/\${id}\`;
        try {
          await navigator.clipboard.writeText(url);
          alert('链接已复制到剪贴板');
        } catch (err) {
          // 降级处理：创建临时输入框
          const input = document.createElement('input');
          input.value = url;
          document.body.appendChild(input);
          input.select();
          document.execCommand('copy');
          document.body.removeChild(input);
          alert('链接已复制到剪贴板');
        }
      };

      if (loading) {
        return <div className="text-center py-8">加载中...</div>;
      }

      return (
        <div className="space-y-6">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">配置模板列表</h2>
            <button
              onClick={onNew}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
            >
              创建新模板
            </button>
          </div>

          {error ? (
            <div className="text-center py-8">
              <div className="text-red-500 mb-4">{error}</div>
              <button
                onClick={fetchTemplates}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                重试
              </button>
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              暂无模板，点击右上角创建新模板
            </div>
          ) : (
            <div className="space-y-4">
              {templates.map(template => (
                <div key={template.id} className="border p-4 rounded bg-white">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm text-gray-500">
                        创建时间: {new Date(template.createTime).toLocaleString()}
                      </div>
                    </div>
                    <div className="space-x-2">
                      <button
                        onClick={() => window.open(\`/peizhi/template/\${template.id}\`, '_blank')}
                        className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        查看
                      </button>
                      <button
                        onClick={() => copyToClipboard(template.id)}
                        className="px-3 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
                      >
                        复制链接
                      </button>
                      <button
                        onClick={() => handleDelete(template.id, template.name)}
                        className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    // 修改 App 组件
    function App() {
      const [currentStep, setCurrentStep] = React.useState(0);
      const [config, setConfig] = React.useState({
        rules: [],
        proxyGroups: [
          {
            name: "🚀 节点选择",
            type: "select",
            isDefault: true
          }
        ],
        routing: []
      });

      // 当进入第三步时，自动生成分流配置
      React.useEffect(() => {
        if (currentStep === 3) {
          const uniqueRuleNames = [...new Set(config.rules.map(rule => {
            const baseName = rule.name.split(' - ')[0];
            return baseName;
          }))];
          
          const initialRouting = uniqueRuleNames.map(name => ({
            name,
            isReject: name.includes('广告') || 
                     name.includes('净化') || 
                     name.includes('AdBlock')
          }));
          
          setConfig(prev => ({
            ...prev,
            routing: sortRouting(initialRouting)
          }));
        }
      }, [currentStep]);

      const handleGenerate = async (templateName, password) => {
        try {
          const response = await fetch('/peizhi/api/generate', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              ...config,
              templateName,
              password
            })
          });
          
          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.message || '生成失败');
          }
          
          const data = await response.json();
          if (data.success) {
            window.open(\`/peizhi/template/\${data.templateId}\`, '_blank');
            setCurrentStep(0); // 生成成功后返回模板列表
          } else {
            alert('生成配置失败：' + (data.message || '未知错误'));
          }
        } catch (error) {
          console.error('生成配置失败:', error);
          alert('生成配置失败：' + error.message);
        }
      };

      const handleBackToTemplates = () => {
        if (confirm('确定要返回模板管理吗？当前修改将不会保存。')) {
          setCurrentStep(0);
          setConfig({
            rules: [],
            proxyGroups: [
              {
                name: "🚀 节点选择",
                type: "select",
                isDefault: true
              }
            ],
            routing: []
          });
        }
      };

      return (
        <div className="container mx-auto p-4">
          <div className="flex justify-between items-center mb-6">
            <h1 className="text-2xl font-bold">配置生成器</h1>
            {currentStep > 0 && (
              <button
                onClick={handleBackToTemplates}
                className="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600"
              >
                返回模板管理
              </button>
            )}
          </div>

          <div className="steps mb-6">
            <div className={\`step \${currentStep === 0 ? 'active' : ''}\`}>模板管理</div>
            <div className={\`step \${currentStep === 1 ? 'active' : ''}\`}>规则配置</div>
            <div className={\`step \${currentStep === 2 ? 'active' : ''}\`}>节点分组</div>
            <div className={\`step \${currentStep === 3 ? 'active' : ''}\`}>分流配置</div>
          </div>

          {currentStep === 0 && (
            <TemplateListSection
              onNew={() => setCurrentStep(1)}
            />
          )}

          {currentStep === 1 && (
            <RuleSection 
              rules={config.rules}
              onChange={(rules) => setConfig({...config, rules})}
              onNext={() => setCurrentStep(2)}
            />
          )}

          {currentStep === 2 && (
            <ProxyGroupSection
              proxyGroups={config.proxyGroups}
              onChange={(proxyGroups) => setConfig({...config, proxyGroups})}
              onBack={() => setCurrentStep(1)}
              onNext={() => setCurrentStep(3)}
            />
          )}

          {currentStep === 3 && (
            <RoutingSection
              routing={config.routing}
              proxyGroups={config.proxyGroups}
              onChange={(routing) => setConfig({...config, routing})}
              onBack={() => setCurrentStep(2)}
              onGenerate={handleGenerate}
            />
          )}
        </div>
      );
    }

    // RuleSection 组件
    function RuleSection({ rules, onChange, onNext, onBack }) {
      const [selectedRules, setSelectedRules] = React.useState(new Set());
      const [customRules, setCustomRules] = React.useState([{ name: '', url: '' }]);
      const availableRules = React.useMemo(() => parseRules(DEFAULT_RULES), []);

      // 组件加载时自动选择所有预设规则
      React.useEffect(() => {
        setSelectedRules(new Set(availableRules));
        onChange(availableRules);
      }, []);

      const handleRuleToggle = (rule, checked) => {
        const newSelected = new Set(selectedRules);
        if (checked) {
          newSelected.add(rule);
        } else {
          newSelected.delete(rule);
        }
        setSelectedRules(newSelected);
        
        // 并预设规则和自定义规则
        const selectedPresetRules = Array.from(newSelected);
        const validCustomRules = customRules.filter(rule => rule.name && rule.url);
        onChange([...selectedPresetRules, ...validCustomRules]);
      };

      const handleCustomRuleChange = (index, field, value) => {
        const newCustomRules = [...customRules];
        newCustomRules[index][field] = value;
        setCustomRules(newCustomRules);
        
        // 更新所有规则
        const validCustomRules = newCustomRules.filter(rule => rule.name && rule.url);
        const selectedPresetRules = Array.from(selectedRules);
        onChange([...selectedPresetRules, ...validCustomRules]);
      };

      // 添加拖拽排序功能
      const handleDragStart = (e, index) => {
        e.dataTransfer.setData('text/plain', index);
      };

      const handleDragOver = (e) => {
        e.preventDefault();
      };

      const handleDrop = (e, dropIndex) => {
        e.preventDefault();
        const dragIndex = parseInt(e.dataTransfer.getData('text/plain'));
        if (dragIndex === dropIndex) return;

        const newRules = [...rules];
        const [movedRule] = newRules.splice(dragIndex, 1);
        newRules.splice(dropIndex, 0, movedRule);
        onChange(newRules);
      };

      return (
        <div className="space-y-6">
          {/* 预设规则部分 - 三列布局 */}
          <div className="preset-rules">
            <h2 className="text-xl font-semibold mb-4">预设规则</h2>
            <div className="grid grid-cols-3 gap-4">
              {availableRules.map((rule, index) => (
                <div key={index} className="flex items-center">
                  <input
                    type="checkbox"
                    id={"rule-" + index}
                    checked={selectedRules.has(rule)}
                    onChange={(e) => handleRuleToggle(rule, e.target.checked)}
                    className="mr-2"
                  />
                  <label htmlFor={"rule-" + index} className="text-sm">
                    {rule.name}
                    <span className="ml-2 text-xs text-gray-600">
                      {rule.displayName}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* 自定义规则部分 */}
          <div className="custom-rules">
            <h2 className="text-xl font-semibold mb-4">自定义规则</h2>
            {customRules.map((rule, index) => (
              <div key={index} className="flex gap-4 mb-2">
                <input
                  type="text"
                  placeholder="规则名称"
                  value={rule.name}
                  onChange={(e) => handleCustomRuleChange(index, 'name', e.target.value)}
                  className="w-1/3 p-2 border rounded"
                />
                <input
                  type="text"
                  placeholder="规则链接"
                  value={rule.url}
                  onChange={(e) => handleCustomRuleChange(index, 'url', e.target.value)}
                  className="flex-1 p-2 border rounded"
                />
                <button
                  onClick={() => {
                    const newCustomRules = customRules.filter((_, i) => i !== index);
                    setCustomRules(newCustomRules);
                  }}
                  className="px-4 py-2 bg-red-500 text-white rounded"
                >
                  -
                </button>
              </div>
            ))}
            <button
              onClick={() => setCustomRules([...customRules, { name: '', url: '' }])}
              className="px-4 py-2 bg-blue-500 text-white rounded mt-2"
            >
              +
            </button>
          </div>

          {/* 已选规则排序部分 - 三列布局 */}
          {rules.length > 0 && (
            <div className="selected-rules border rounded p-4 bg-gray-50">
              <h2 className="text-sm font-semibold mb-2">规则排序（拖动调整，从左到右，从上到下，按循序优先）</h2>
              <div className="grid grid-cols-3 gap-2">
                {rules.map((rule, index) => (
                  <div
                    key={index}
                    draggable
                    onDragStart={(e) => handleDragStart(e, index)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, index)}
                    className="flex items-center p-2 bg-white border rounded cursor-move hover:bg-gray-100 text-sm"
                  >
                    <div className="flex-1 truncate">
                      {rule.name}
                      <span className="ml-2 text-xs text-gray-600">
                        {rule.displayName}
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        const newRules = rules.filter((_, i) => i !== index);
                        onChange(newRules);
                        setSelectedRules(new Set(newRules));
                      }}
                      className="ml-2 text-red-500 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              onClick={onNext}
              className="px-6 py-2 bg-green-500 text-white rounded"
            >
              下一步
            </button>
          </div>
        </div>
      );
    }

    // ProxyGroupSection 组件
    ${ProxyGroupSectionComponent}

    // RoutingSection 组件
    function RoutingSection({ routing, proxyGroups, onChange, onBack, onGenerate }) {
      const [templateName, setTemplateName] = React.useState('');
      const [password, setPassword] = React.useState('');
      
      const handleGenerate = () => {
        if (!templateName.trim()) {
          alert('请输入模板名称');
          return;
        }
        if (!password.trim()) {
          alert('请输入管理密码');
          return;
        }
        onGenerate(templateName, password);
      };

      return (
        <div className="space-y-6">
          <h2 className="text-xl font-semibold mb-4">分流配置</h2>
          <p className="text-gray-600 mb-4">
            以下是根据您选择的规则自动生成的分流配置：
          </p>

          <div className="grid grid-cols-5 gap-4">
            {routing.map((route, index) => (
              <div key={index} className="border p-4 rounded">
                <div className="font-medium">{route.name}</div>
                <div className="text-sm text-gray-600 mt-1">
                  {route.isReject ? (
                    '拦截规则：REJECT, DIRECT'
                  ) : (
                    <div className="text-xs space-y-1">
                      <div>代理规则，可选节点：</div>
                      <div className="pl-2">
                        {proxyGroups.map(g => (
                          <div key={g.name}>{g.name}</div>
                        ))}
                        <div>DIRECT</div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 border-t pt-6">
            <h3 className="text-lg font-semibold mb-4">保存模板</h3>
            <div className="space-y-4">
              <div className="flex gap-4 items-center">
                <input
                  type="text"
                  placeholder="请输入模板名称"
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  className="flex-1 p-2 border rounded"
                />
              </div>
              <div className="flex gap-4 items-center">
                <input
                  type="password"
                  placeholder="请输入管理密码"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="flex-1 p-2 border rounded"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-between">
            <button
              onClick={onBack}
              className="px-6 py-2 bg-gray-500 text-white rounded"
            >
              上一步
            </button>
            <button
              onClick={handleGenerate}
              className="px-6 py-2 bg-green-500 text-white rounded"
            >
              生成配置
            </button>
          </div>
        </div>
      );
    }

    // 渲染应用
    ReactDOM.render(<App />, document.getElementById('root'));
  `;
}

// ProxyGroupSection 组件代码
const ProxyGroupSectionComponent = `
function ProxyGroupSection({ proxyGroups, onChange, onBack, onNext }) {
  const addProxyGroup = () => {
    onChange([...proxyGroups, {
      name: '',
      type: 'select',
      filterType: 'regex',
      keywords: ''
    }]);
  };

  const removeProxyGroup = (index) => {
    if (proxyGroups[index].isDefault) return;
    const newGroups = proxyGroups.filter((_, i) => i !== index);
    onChange(newGroups);
  };

  const updateProxyGroup = (index, field, value) => {
    const newGroups = [...proxyGroups];
    newGroups[index][field] = value;
    onChange(newGroups);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold mb-4">节点分组配置</h2>

      {proxyGroups.map((group, index) => (
        <div key={index} className="border p-4 rounded space-y-4">
          <div className="flex gap-4">
            <input
              type="text"
              placeholder="分组名称"
              value={group.name}
              onChange={(e) => updateProxyGroup(index, 'name', e.target.value)}
              disabled={group.isDefault}
              className="flex-1 p-2 border rounded"
            />
            <select
              value={group.type}
              onChange={(e) => updateProxyGroup(index, 'type', e.target.value)}
              className="p-2 border rounded"
            >
              <option value="select">手动选择</option>
              <option value="auto">自动测速</option>
            </select>
            {!group.isDefault && (
              <button
                onClick={() => removeProxyGroup(index)}
                className="px-4 py-2 bg-red-500 text-white rounded"
              >
                删除
              </button>
            )}
          </div>

          {!group.isDefault && (
            <div className="flex gap-4">
              <select
                value={group.filterType}
                onChange={(e) => updateProxyGroup(index, 'filterType', e.target.value)}
                className="p-2 border rounded"
              >
                <option value="regex">正则匹配</option>
                <option value="inverse">反向匹配</option>
                <option value="both">组合匹配</option>
              </select>
              <input
                type="text"
                placeholder={
                  group.filterType === 'regex' ? '关键词1|关键词2' :
                  group.filterType === 'inverse' ? '排除关键词1|排除关键词2' :
                  '排除关键词1|排除关键词2;;包含关键词1|包含关键词2'
                }
                value={group.keywords}
                onChange={(e) => updateProxyGroup(index, 'keywords', e.target.value)}
                className="flex-1 p-2 border rounded"
              />
            </div>
          )}
        </div>
      ))}

      <button
        onClick={addProxyGroup}
        className="px-4 py-2 bg-blue-500 text-white rounded"
      >
        添加分组
      </button>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 bg-gray-500 text-white rounded"
        >
          上一步
        </button>
        <button
          onClick={onNext}
          className="px-6 py-2 bg-green-500 text-white rounded"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
`;

// 替换为新的导出格式
export {
    handleGenerateConfig,
    handleGetTemplate,
    handleListTemplates,
    handleDeleteTemplate,
    generateTemplate,  // 如果其他地方需要使用这个函数
    generateTemplateManagerHTML,      // 如果其他地方需要使用这个函数
};