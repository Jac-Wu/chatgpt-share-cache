import type { ChatMessage } from '../shared/types';

export interface DemoConversation {
  id: string;
  title: string;
  category: string;
  description: string;
  color: string;
  messages: ChatMessage[];
}

export const demos: DemoConversation[] = [
  {
    id: 'ideas',
    title: '把模糊的灵感，变成可执行的计划',
    category: '灵感与效率',
    description: '从一个小小的念头开始，找到迈出第一步的方法。',
    color: 'peach',
    messages: [
      { id: 'ideas-1', role: 'user', content: '我有很多想做的事情，但总是停留在想法阶段。可以帮我设计一个简单、容易坚持的行动工作流吗？' },
      { id: 'ideas-2', role: 'assistant', content: '当然。不妨先放下「完美计划」，给想法一条足够短的落地路径。\n\n## 一个三步工作流\n\n### 1. 捕捉：先留下，不评判\n\n给所有灵感一个统一的收件箱。每条只写一句话：**我想为谁，解决什么问题？** 不急着分类，也不急着证明它值得做。\n\n### 2. 澄清：找到最小的下一步\n\n每周选出一个仍让你心动的想法，把它变成一个 **25 分钟内可以完成的动作**。\n\n| 模糊的想法 | 清晰的下一步 |\n| --- | --- |\n| 我想写一篇文章 | 写下三个想回答的问题 |\n| 我想做一个产品 | 画出唯一一个核心页面 |\n| 我想开始运动 | 把运动鞋放在门口，散步十分钟 |\n\n### 3. 回看：记录发生了什么\n\n完成后，只回答两个问题：\n\n- 我实际学到了什么？\n- 还想继续吗？如果想，下一小步是什么？\n\n> 进展不一定是完成了一件大事，也可以是让一件事比昨天更清楚。' },
      { id: 'ideas-3', role: 'user', content: '如果我同时对好几个想法都很有热情，该怎么选？' },
      { id: 'ideas-4', role: 'assistant', content: '试试这个简单的筛选方式，不需要精确打分：\n\n1. **好奇心**：即使没人看到，我也愿意花时间了解它吗？\n2. **可行动性**：今天就能做一个小实验吗？\n3. **真实需求**：它解决的是我亲身遇到的问题吗？\n\n三个问题都答「是」的，先做。其他想法放进「以后再见」清单，而不是删除。\n\n给自己一周的试用期，而不是一辈子的承诺。**选择只是决定先从哪里开始，不是决定永远不做什么。**' },
    ],
  },
  {
    id: 'design',
    title: '好的界面，如何做到少即是多？',
    category: '设计与创造',
    description: '关于留白、层次，以及那些恰到好处的小细节。',
    color: 'lavender',
    messages: [
      { id: 'design-1', role: 'user', content: '我正在做一个个人知识库，如何让页面简洁，但又不显得空洞？' },
      { id: 'design-2', role: 'assistant', content: '简洁不是删掉一切，而是让每一个留下的元素都拥有清晰的理由。\n\n## 先设计注意力，再设计界面\n\n一个页面最好只有一个最重要的动作。以知识库为例，它可能是「保存新内容」，也可能是「找回旧内容」。先决定主角，其他元素才能成为配角。\n\n### 三个可以马上尝试的细节\n\n- **用距离表达关系**：属于一组的元素放近一些，不同组之间多留一点空间。\n- **减少强调色的使用**：把颜色留给主要操作和真正重要的状态。\n- **为真实内容做设计**：长标题、空状态、加载失败，都应该得到照顾。\n\n> 留白并不是没有内容，而是在为内容留出呼吸的空间。\n\n最后，把页面缩小到 50% 看一眼：如果仍能一眼找到最重要的内容，层次通常就走在正确的方向上。' },
    ],
  },
  {
    id: 'code',
    title: '从零理解异步：让代码慢慢说',
    category: '代码与学习',
    description: '把难懂的概念拆小，用一个例子建立直觉。',
    color: 'sage',
    messages: [
      { id: 'code-1', role: 'user', content: '能用一个容易理解的例子解释 JavaScript 的 async / await 吗？最好带上错误处理。' },
      { id: 'code-2', role: 'assistant', content: '把异步想成在咖啡店点单：你下单后，不必一直站在柜台前。咖啡做好时，再回来取就可以了。\n\n`Promise` 像一张取餐小票；`await` 表达「在这一步，等结果准备好再继续」。它只暂停当前异步函数，不会阻塞整个页面。\n\n## 一个完整的小例子\n\n```javascript\nasync function loadConversation(archiveId) {\n  try {\n    const response = await fetch(`/api/archives/${archiveId}`);\n\n    if (!response.ok) {\n      throw new Error(`请求失败：${response.status}`);\n    }\n\n    const conversation = await response.json();\n    return conversation;\n  } catch (error) {\n    console.error("暂时无法读取对话", error);\n    throw error;\n  }\n}\n```\n\n### 记住这三件事\n\n1. `async` 函数始终返回一个 Promise。\n2. `await` 会等待 Promise 完成，并拿到它的结果。\n3. 用 `try / catch` 处理失败，但不要悄悄吞掉错误。\n\n**一个容易忽略的细节：** `fetch` 收到 404 或 500 响应时不一定抛出异常，所以我们需要检查 `response.ok`。' },
    ],
  },
];
