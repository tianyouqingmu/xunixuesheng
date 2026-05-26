(function () {
  const scenarios = [
    {
      id: "imread-none",
      studentName: "小林",
      title: "读图后直接 shape",
      lesson: "图像读写",
      mistake: "imread 读取失败未判空",
      tags: ["imread", "None", "路径"],
      code: `import cv2

img = cv2.imread("D:/测试图片/工件.jpg")

print("图像尺寸:", img.shape)
cv2.imshow("img", img)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
      terminal: `Traceback (most recent call last):
  File "student_demo.py", line 5, in <module>
    print("图像尺寸:", img.shape)
AttributeError: 'NoneType' object has no attribute 'shape'`,
      why: "cv2.imread 读不到图像时不会主动报错，而是返回 None。路径含中文、文件名或后缀写错时，小白最容易跳过判空，后面访问 img.shape 才爆出 NoneType 错误。",
      fix: "读图后先判断 img is None。中文路径可以优先改成英文路径，或用 np.fromfile + cv2.imdecode。",
      warning: "读图第一步先判空，不要等 shape 替你报错。",
      correctCode: `import cv2
import numpy as np

img_path = "D:/测试图片/工件.jpg"
img = cv2.imdecode(np.fromfile(img_path, dtype=np.uint8), cv2.IMREAD_COLOR)

if img is None:
    print("图像读取失败，请检查路径/文件名/后缀名")
    raise SystemExit

print("图像尺寸:", img.shape)
cv2.imshow("img", img)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
    {
      id: "waitkey-missing",
      studentName: "小周",
      title: "窗口一闪而过",
      lesson: "图像显示",
      mistake: "imshow 后漏写 waitKey",
      tags: ["imshow", "waitKey", "窗口"],
      code: `import cv2

img = cv2.imread("1.jpg")
cv2.imshow("img", img)
cv2.destroyAllWindows()`,
      terminal: `程序没有抛出 Python 异常。
窗口一闪而过，画面没有稳定显示。

OpenCV 窗口没有等待按键，也没有完成刷新。`,
      why: "cv2.imshow 只是提交显示任务，真正让窗口刷新和停留的是 cv2.waitKey。没有 waitKey 时，程序会继续执行 destroyAllWindows，窗口自然一闪而过。",
      fix: "显示静态图像时使用 cv2.waitKey(0)。视频循环中按帧率设置 waitKey 的毫秒数。",
      warning: "imshow 和 waitKey 要成对出现，窗口才有时间显示。",
      correctCode: `import cv2

img = cv2.imread("1.jpg")
if img is None:
    print("图像读取失败")
    raise SystemExit

cv2.imshow("img", img)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
    {
      id: "roi-coordinate-order",
      studentName: "小顾",
      title: "框和 ROI 对不上",
      lesson: "坐标与 ROI",
      mistake: "绘图坐标和数组切片顺序混淆",
      tags: ["ROI", "rectangle", "x/y"],
      code: `import cv2

img = cv2.imread("1.jpg")
h, w = img.shape[:2]

x1, y1 = 50, 100
x2, y2 = 150, 200

cv2.rectangle(img, (y1, x1), (y2, x2), (0, 0, 255), 2)
roi = img[x1:x2, y1:y2]

print("ROI shape:", roi.shape)
cv2.imshow("img", img)
cv2.imshow("roi", roi)
cv2.waitKey(0)`,
      terminal: `ROI shape: (100, 100, 3)
程序运行完成，但矩形框位置偏移，ROI 截取区域不是预期目标。

异常类型：逻辑错误，无 Python 报错。`,
      why: "OpenCV 绘图函数使用 (x, y)，而 NumPy 图像切片使用 img[y1:y2, x1:x2]。把两套顺序混在一起时，程序可能不报错，但结果会悄悄错位。",
      fix: "统一先写 x1, y1, x2, y2。绘图用 (x, y)，切片用 [y, x]。",
      warning: "坐标题最怕“能运行但结果错”，画框和切片顺序要分开记。",
      correctCode: `import cv2

img = cv2.imread("1.jpg")
if img is None:
    raise SystemExit

x1, y1 = 50, 100
x2, y2 = 150, 200

cv2.rectangle(img, (x1, y1), (x2, y2), (0, 0, 255), 2)
roi = img[y1:y2, x1:x2]

print("ROI shape:", roi.shape)
cv2.imshow("img", img)
cv2.imshow("roi", roi)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
    {
      id: "calchist-brackets",
      studentName: "小郑",
      title: "直方图参数漏方括号",
      lesson: "直方图",
      mistake: "calcHist 核心参数未用列表包裹",
      tags: ["calcHist", "参数", "列表"],
      code: `import cv2
import matplotlib.pyplot as plt

img = cv2.imread("1.jpg", 0)

hist = cv2.calcHist(img, 0, None, 256, 0, 255)

plt.plot(hist)
plt.show()`,
      terminal: `Traceback (most recent call last):
  File "student_demo.py", line 6, in <module>
    hist = cv2.calcHist(img, 0, None, 256, 0, 255)
TypeError: Expected Ptr<cv::UMat> for argument 'images'`,
      why: "cv2.calcHist 的 images、channels、histSize、ranges 都要求列表形式。哪怕只有一张图、一个通道，也要写成 [img]、[0]、[256]、[0, 255]。",
      fix: "把四个核心参数都用方括号包起来，并在读图后判空。",
      warning: "calcHist 不是凭直觉传参，四个核心参数都要套列表。",
      correctCode: `import cv2
import matplotlib.pyplot as plt

img = cv2.imread("1.jpg", 0)
if img is None:
    raise SystemExit

hist = cv2.calcHist([img], [0], None, [256], [0, 255])

plt.plot(hist)
plt.show()`,
    },
    {
      id: "findcontours-unpack",
      studentName: "小杜",
      title: "轮廓返回值写成旧版本",
      lesson: "轮廓检测",
      mistake: "OpenCV4 findContours 解包数量错误",
      tags: ["findContours", "OpenCV4", "解包"],
      code: `import cv2

img = cv2.imread("1.jpg", 0)
ret, binary = cv2.threshold(img, 127, 255, cv2.THRESH_BINARY)

image, contours, hierarchy = cv2.findContours(
    binary,
    cv2.RETR_TREE,
    cv2.CHAIN_APPROX_SIMPLE
)

print("轮廓数量:", len(contours))`,
      terminal: `Traceback (most recent call last):
  File "student_demo.py", line 6, in <module>
    image, contours, hierarchy = cv2.findContours(...)
ValueError: not enough values to unpack (expected 3, got 2)`,
      why: "OpenCV 3.x 的 findContours 返回 3 个值，OpenCV 4.x 返回 2 个值。现在课堂和新环境大多是 OpenCV 4，所以照搬旧代码会解包失败。",
      fix: "OpenCV 4 使用 contours, hierarchy = cv2.findContours(...)。如果必须兼容旧环境，再做版本判断或根据返回长度处理。",
      warning: "网上旧代码能抄，返回值数量不能跟着盲抄。",
      correctCode: `import cv2

img = cv2.imread("1.jpg", 0)
if img is None:
    raise SystemExit

ret, binary = cv2.threshold(img, 127, 255, cv2.THRESH_BINARY)
contours, hierarchy = cv2.findContours(
    binary,
    cv2.RETR_TREE,
    cv2.CHAIN_APPROX_SIMPLE
)

print("轮廓数量:", len(contours))`,
    },
    {
      id: "adaptive-even-block",
      studentName: "小韩",
      title: "自适应阈值 blockSize 偶数",
      lesson: "阈值处理",
      mistake: "adaptiveThreshold blockSize 不合法",
      tags: ["threshold", "blockSize", "奇数"],
      code: `import cv2

img = cv2.imread("1.jpg", 0)

binary = cv2.adaptiveThreshold(
    img,
    255,
    cv2.ADAPTIVE_THRESH_MEAN_C,
    cv2.THRESH_BINARY,
    4,
    10
)

cv2.imshow("binary", binary)
cv2.waitKey(0)`,
      terminal: `cv2.error: OpenCV(...) error: (-215:Assertion failed)
blockSize % 2 == 1 && blockSize > 1
in function 'cv::adaptiveThreshold'`,
      why: "adaptiveThreshold 的 blockSize 必须是大于 1 的奇数。学生常把 4、6、10 当成普通窗口大小直接填，OpenCV 会用断言报错。",
      fix: "blockSize 使用 3、5、7、9、11 等奇数。图像读取后也要先判空。",
      warning: "自适应阈值的窗口大小必须是大于 1 的奇数。",
      correctCode: `import cv2

img = cv2.imread("1.jpg", 0)
if img is None:
    raise SystemExit

binary = cv2.adaptiveThreshold(
    img,
    255,
    cv2.ADAPTIVE_THRESH_MEAN_C,
    cv2.THRESH_BINARY,
    5,
    10
)

cv2.imshow("binary", binary)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
    {
      id: "bgr-rgb-mix",
      studentName: "小沈",
      title: "红蓝颜色反了",
      lesson: "颜色空间",
      mistake: "把 OpenCV BGR 当成 RGB",
      tags: ["BGR", "RGB", "matplotlib"],
      code: `import cv2
import matplotlib.pyplot as plt

img = cv2.imread("workpiece.jpg")

plt.imshow(img)
plt.title("workpiece")
plt.show()

hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)`,
      terminal: `程序没有抛出异常。
matplotlib 显示时红蓝反转，HSV 提取结果也明显偏色。

异常类型：颜色空间逻辑错误。`,
      why: "OpenCV 读入彩色图像默认是 BGR，不是 RGB。直接给 matplotlib 显示会红蓝反转，做 HSV 转换时也应该从 BGR 转换。",
      fix: "给 matplotlib 显示前用 COLOR_BGR2RGB。做 HSV 提取时使用 COLOR_BGR2HSV。",
      warning: "OpenCV 的彩色图默认是 BGR，颜色错了先查通道顺序。",
      correctCode: `import cv2
import matplotlib.pyplot as plt

img = cv2.imread("workpiece.jpg")
if img is None:
    raise SystemExit

img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
plt.imshow(img_rgb)
plt.title("workpiece")
plt.show()

hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)`,
    },
    {
      id: "matchtemplate-minmax",
      studentName: "小唐",
      title: "模板匹配取反了",
      lesson: "模板匹配",
      mistake: "TM_SQDIFF 却取 max_loc",
      tags: ["matchTemplate", "minLoc", "maxLoc"],
      code: `import cv2

img = cv2.imread("workpiece.jpg", 0)
template = cv2.imread("template.jpg", 0)
h, w = template.shape

res = cv2.matchTemplate(img, template, cv2.TM_SQDIFF_NORMED)
min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

top_left = max_loc
bottom_right = (top_left[0] + w, top_left[1] + h)

cv2.rectangle(img, top_left, bottom_right, 255, 2)
cv2.imshow("result", img)
cv2.waitKey(0)`,
      terminal: `min_val=0.031, max_val=0.974
学生选择 top_left=max_loc=(312, 44)
程序运行完成，但匹配框落在错误区域。

异常类型：匹配规则用反，无 Python 报错。`,
      why: "TM_SQDIFF 和 TM_SQDIFF_NORMED 属于方差类方法，值越小越匹配。学生取 max_loc 等于故意选最不像模板的位置。",
      fix: "方差类取 min_loc；相关类和相关系数类取 max_loc。",
      warning: "模板匹配先看方法类型，再决定取 minLoc 还是 maxLoc。",
      correctCode: `import cv2

img = cv2.imread("workpiece.jpg", 0)
template = cv2.imread("template.jpg", 0)
if img is None or template is None:
    raise SystemExit

h, w = template.shape
res = cv2.matchTemplate(img, template, cv2.TM_SQDIFF_NORMED)
min_val, max_val, min_loc, max_loc = cv2.minMaxLoc(res)

top_left = min_loc
bottom_right = (top_left[0] + w, top_left[1] + h)

cv2.rectangle(img, top_left, bottom_right, 255, 2)
cv2.imshow("result", img)
cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
    {
      id: "blur-window-api-typos",
      studentName: "小赵",
      title: "均值模糊窗口函数连环错误",
      lesson: "图像滤波",
      mistake: "imshow / waitKey / destroyAllWindows 写错",
      tags: ["blur", "imshow", "waitKey", "destroyAllWindows"],
      code: `# 均值模糊
import cv2

img = cv2.imread("pcb.jpg")
cv2.imshow("img,img")

img2 = cv2.blur(img, (20, 20))
cv2.imshow("imgBlur", img2)

cv2.waitkey(0)
cv2.destoryAllWindow()`,
      terminal: `Traceback (most recent call last):
  File "student_demo.py", line 5, in <module>
    cv2.imshow("img,img")
cv2.error: OpenCV(...) error: (-5:Bad argument) in function 'imshow'
> imshow() missing required argument 'mat' (pos 2)

如果把这里改过，后面还会遇到：
AttributeError: module 'cv2' has no attribute 'waitkey'
AttributeError: module 'cv2' has no attribute 'destoryAllWindow'`,
      why: "cv2.imshow 的第一个参数是窗口名，第二个参数才是图像变量。学生把 img 也写进引号后，img 不再是图像，而是字符串的一部分。后面的 waitkey 还把 K 写成小写，destoryAllWindow 又把 destroy 拼错并且少了 Windows 末尾的 s。",
      mindset: "这类错误通常不是不会均值模糊，而是急着看到模糊结果，注意力全放在 cv2.blur 的参数上，忽略了显示、等待和关闭窗口这些固定代码的大小写、括号和拼写。",
      fix: "先写标准窗口三件套：cv2.imshow(\"img\", img)、cv2.waitKey(0)、cv2.destroyAllWindows()。均值模糊使用 cv2.blur(img, (20, 20))，显示模糊图时再写 cv2.imshow(\"imgBlur\", img2)。",
      warning: "均值模糊不是只看 blur，imshow、waitKey、destroyAllWindows 也要逐字核对。",
      correctCode: `import cv2

img = cv2.imread("pcb.jpg")
if img is None:
    print("图像读取失败，请检查 pcb.jpg 是否存在")
    raise SystemExit

cv2.imshow("img", img)

img2 = cv2.blur(img, (20, 20))
cv2.imshow("imgBlur", img2)

cv2.waitKey(0)
cv2.destroyAllWindows()`,
    },
  ];

  function lessons() {
    return Array.from(new Set(scenarios.map((item) => item.lesson)));
  }

  function scenarioById(id) {
    return scenarios.find((item) => item.id === id) || scenarios[0];
  }

  function normalizeScenario(raw) {
    const fallback = scenarios[0];
    const copy = Object.assign({}, fallback, raw || {});
    copy.id = copy.id || `custom-${Date.now()}`;
    copy.studentName = copy.studentName || "虚拟学生";
    copy.tags = Array.isArray(copy.tags) ? copy.tags : [];
    copy.mindset = copy.mindset || "这类错误通常不是不会写，而是急着看到结果，跳过了输入、返回值和边界条件检查。";
    return copy;
  }

  window.StudentEngine = {
    scenarios,
    lessons,
    scenarioById,
    normalizeScenario,
  };
})();
