import AppKit
import Foundation

let output = URL(fileURLWithPath: CommandLine.arguments[1])
let sizes = [16, 32, 128, 256, 512]
try? FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)

func point(_ x: CGFloat, _ y: CGFloat, in rect: NSRect) -> NSPoint {
    NSPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
}

// 鲸鱼主体：保留原有剪影轮廓与纯几何填充风格，不引入描边线条语言。
func drawWhale(in rect: NSRect, color: NSColor) {
    let body = NSBezierPath()
    body.move(to: point(0.28, 0.48, in: rect))
    body.curve(to: point(0.30, 0.70, in: rect), controlPoint1: point(0.28, 0.63, in: rect), controlPoint2: point(0.42, 0.81, in: rect))
    body.curve(to: point(0.68, 0.79, in: rect), controlPoint1: point(0.53, 0.83, in: rect), controlPoint2: point(0.82, 0.78, in: rect))
    body.curve(to: point(0.93, 0.57, in: rect), controlPoint1: point(0.93, 0.74, in: rect), controlPoint2: point(0.98, 0.62, in: rect))
    body.curve(to: point(0.72, 0.30, in: rect), controlPoint1: point(0.89, 0.47, in: rect), controlPoint2: point(0.82, 0.29, in: rect))
    body.curve(to: point(0.43, 0.28, in: rect), controlPoint1: point(0.61, 0.28, in: rect), controlPoint2: point(0.49, 0.31, in: rect))
    body.curve(to: point(0.28, 0.48, in: rect), controlPoint1: point(0.34, 0.34, in: rect), controlPoint2: point(0.27, 0.41, in: rect))
    body.close()
    color.setFill(); body.fill()

    let tail = NSBezierPath()
    tail.move(to: point(0.34, 0.53, in: rect))
    tail.curve(to: point(0.16, 0.72, in: rect), controlPoint1: point(0.26, 0.65, in: rect), controlPoint2: point(0.13, 0.76, in: rect))
    tail.curve(to: point(0.10, 0.63, in: rect), controlPoint1: point(0.08, 0.69, in: rect), controlPoint2: point(0.07, 0.65, in: rect))
    tail.curve(to: point(0.22, 0.47, in: rect), controlPoint1: point(0.12, 0.58, in: rect), controlPoint2: point(0.18, 0.49, in: rect))
    tail.curve(to: point(0.10, 0.34, in: rect), controlPoint1: point(0.17, 0.44, in: rect), controlPoint2: point(0.09, 0.39, in: rect))
    tail.curve(to: point(0.17, 0.29, in: rect), controlPoint1: point(0.10, 0.28, in: rect), controlPoint2: point(0.13, 0.27, in: rect))
    tail.curve(to: point(0.35, 0.48, in: rect), controlPoint1: point(0.22, 0.32, in: rect), controlPoint2: point(0.30, 0.40, in: rect))
    tail.close()
    color.setFill(); tail.fill()

    let fin = NSBezierPath()
    fin.move(to: point(0.56, 0.33, in: rect))
    fin.curve(to: point(0.48, 0.17, in: rect), controlPoint1: point(0.54, 0.27, in: rect), controlPoint2: point(0.48, 0.21, in: rect))
    fin.curve(to: point(0.65, 0.30, in: rect), controlPoint1: point(0.53, 0.16, in: rect), controlPoint2: point(0.62, 0.25, in: rect))
    fin.close()
    color.setFill(); fin.fill()

    let spout = NSBezierPath()
    spout.lineWidth = rect.width * 0.055
    spout.lineCapStyle = .round
    spout.move(to: point(0.66, 0.77, in: rect))
    spout.curve(to: point(0.63, 0.92, in: rect), controlPoint1: point(0.66, 0.84, in: rect), controlPoint2: point(0.61, 0.86, in: rect))
    spout.move(to: point(0.68, 0.78, in: rect))
    spout.curve(to: point(0.75, 0.90, in: rect), controlPoint1: point(0.70, 0.84, in: rect), controlPoint2: point(0.75, 0.84, in: rect))
    color.setStroke(); spout.stroke()
}

for size in sizes {
    let image = NSImage(size: NSSize(width: size, height: size), flipped: false) { rect in
        NSColor(calibratedRed: 0.12, green: 0.40, blue: 0.92, alpha: 1).setFill()
        NSBezierPath(roundedRect: rect.insetBy(dx: CGFloat(size) * 0.08, dy: CGFloat(size) * 0.08), xRadius: CGFloat(size) * 0.22, yRadius: CGFloat(size) * 0.22).fill()
        drawWhale(in: rect.insetBy(dx: CGFloat(size) * 0.12, dy: CGFloat(size) * 0.12), color: .white)
        return true
    }
    image.lockFocus()
    let rep = image.tiffRepresentation.flatMap(NSBitmapImageRep.init(data:))
    image.unlockFocus()
    try rep?.representation(using: .png, properties: [:])?.write(to: output.appendingPathComponent("icon_\(size)x\(size).png"))
}
