import os
import math
from PIL import Image, ImageDraw, ImageFilter

def create_neon_m_master():
    size = 1024
    base = Image.new('RGBA', (size, size), (12, 10, 26, 255))
    
    # 1. Cyber background grid
    grid_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(grid_img)
    grid_color = (60, 50, 110, 90)
    for x in range(0, size, 64):
        gdraw.line([(x, 0), (x, size)], fill=grid_color, width=2)
    for y in range(0, size, 64):
        gdraw.line([(0, y), (size, y)], fill=grid_color, width=2)
    
    # Grid glow in center
    base = Image.alpha_composite(base, grid_img)

    # 2. Render 3D Inner Layer & Outer Glow Layer
    # Shapes definition
    # Outer M ribbon
    glow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    
    # Let's draw the vibrant segments
    # Segment 1: Left pillar & arch (Magenta/Pink: #ff2a9d)
    # Segment 2: Middle wave & bridge (Purple/Violet: #b035f8)
    # Segment 3: Right pillar & middle drop (Cyan/Sky: #00f0ff)

    # Coords mapped from 1024x1024
    # Left pillar: x=160..240, y=100..780
    # Left arch: curve from (200, 100) -> (450, 320)
    # Middle bridge: curve from (450, 320) -> (600, 220)
    # Right arch: curve from (600, 220) -> (800, 180)
    # Right pillar: x=780..860, y=180..780
    # Middle drop pillar: x=520..600, y=360..920

    # Draw neon paths with thick width and color gradient
    def draw_glowing_poly(draw_ctx, pts, color, width=32):
        for i in range(len(pts) - 1):
            draw_ctx.line([pts[i], pts[i+1]], fill=color, width=width, joint='curve')

    # Coordinates for the stylized M
    # Outer stroke points
    # Left M:
    left_outer = [
        (160, 780), (160, 100), (420, 100), 
        (580, 260), (740, 120), (880, 120), (880, 760)
    ]
    
    # Inner / Middle drop structure:
    middle_drop = [
        (480, 340), (480, 920), (620, 920), (620, 420),
        (760, 420), (760, 760)
    ]
    
    # Inner left structure:
    left_inner = [
        (280, 780), (280, 340), (480, 340)
    ]

    # Create high-res vector-like canvas
    logo_canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    ldraw = ImageDraw.Draw(logo_canvas)

    # 1. 3D Body fill / shadow
    body_fill = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    bdraw = ImageDraw.Draw(body_fill)
    
    # Left leg
    bdraw.rectangle([(160, 120), (260, 780)], fill=(210, 35, 140, 180))
    # Left arch
    bdraw.polygon([(160, 120), (440, 120), (520, 260), (400, 340), (260, 340), (260, 120)], fill=(180, 40, 180, 180))
    # Middle bridge
    bdraw.polygon([(400, 340), (560, 260), (680, 180), (760, 260), (620, 380)], fill=(140, 60, 220, 180))
    # Right arch & leg
    bdraw.polygon([(680, 180), (860, 180), (860, 760), (760, 760), (760, 280), (680, 280)], fill=(40, 160, 240, 180))
    # Middle deep drop leg
    bdraw.rectangle([(520, 360), (620, 920)], fill=(30, 180, 255, 190))
    bdraw.rectangle([(260, 420), (360, 780)], fill=(160, 35, 180, 180))

    # 2. Gradient Stroke Lines
    # Magenta Left Outline
    glow_pink = (255, 45, 160, 255)
    glow_purple = (185, 60, 255, 255)
    glow_cyan = (0, 240, 255, 255)
    
    # Left arch & leg
    ldraw.line([(160, 780), (160, 120)], fill=glow_pink, width=28)
    ldraw.line([(160, 120), (440, 120)], fill=glow_pink, width=28)
    ldraw.line([(440, 120), (560, 260)], fill=glow_purple, width=28)
    
    # Middle wave
    ldraw.line([(560, 260), (720, 160)], fill=glow_purple, width=28)
    ldraw.line([(720, 160), (860, 160)], fill=glow_cyan, width=28)
    ldraw.line([(860, 160), (860, 760)], fill=glow_cyan, width=28)
    
    # Inner arches & drops
    ldraw.line([(260, 780), (260, 340)], fill=glow_pink, width=24)
    ldraw.line([(260, 340), (420, 340)], fill=glow_purple, width=24)
    ldraw.line([(420, 340), (520, 360)], fill=glow_purple, width=24)
    ldraw.line([(520, 360), (520, 920)], fill=glow_cyan, width=24)
    ldraw.line([(520, 920), (620, 920)], fill=glow_cyan, width=24)
    ldraw.line([(620, 920), (620, 380)], fill=glow_cyan, width=24)
    ldraw.line([(620, 380), (760, 380)], fill=glow_cyan, width=24)
    ldraw.line([(760, 380), (760, 760)], fill=glow_cyan, width=24)

    # Core white neon laser tubes in center
    core_pink = (255, 180, 220, 255)
    core_purple = (220, 180, 255, 255)
    core_cyan = (200, 250, 255, 255)
    
    ldraw.line([(160, 780), (160, 120), (440, 120)], fill=core_pink, width=10)
    ldraw.line([(440, 120), (560, 260), (720, 160)], fill=core_purple, width=10)
    ldraw.line([(720, 160), (860, 160), (860, 760)], fill=core_cyan, width=10)
    
    ldraw.line([(260, 780), (260, 340), (420, 340), (520, 360), (520, 920), (620, 920), (620, 380), (760, 380), (760, 760)], fill=core_cyan, width=8)

    # Glow bloom passes
    glow1 = logo_canvas.filter(ImageFilter.GaussianBlur(32))
    glow2 = logo_canvas.filter(ImageFilter.GaussianBlur(16))
    glow3 = logo_canvas.filter(ImageFilter.GaussianBlur(6))

    # Composite layers
    base = Image.alpha_composite(base, body_fill)
    base = Image.alpha_composite(base, glow1)
    base = Image.alpha_composite(base, glow2)
    base = Image.alpha_composite(base, glow3)
    base = Image.alpha_composite(base, logo_canvas)

    return base

master = create_neon_m_master()

# Save master icon.png
master_512 = master.resize((512, 512), Image.Resampling.LANCZOS)
master_512.save('src-tauri/icons/icon.png')
master_512.save('src-tauri/icons/512x512.png')
master_512.save('public/icons/icon-512.png')

# 192, 128, 64, 32, etc.
master.resize((192, 192), Image.Resampling.LANCZOS).save('public/icons/icon-192.png')
master.resize((180, 180), Image.Resampling.LANCZOS).save('public/icons/apple-touch-icon.png')
master.resize((256, 256), Image.Resampling.LANCZOS).save('src-tauri/icons/128x128@2x.png')
master.resize((128, 128), Image.Resampling.LANCZOS).save('src-tauri/icons/128x128.png')
master.resize((64, 64), Image.Resampling.LANCZOS).save('src-tauri/icons/64x64.png')
master.resize((32, 32), Image.Resampling.LANCZOS).save('src-tauri/icons/32x32.png')

# Windows Tiles
for tile, sz in [
    ('Square30x30Logo.png', 30), ('Square44x44Logo.png', 44),
    ('Square71x71Logo.png', 71), ('Square89x89Logo.png', 89),
    ('Square107x107Logo.png', 107), ('Square142x142Logo.png', 142),
    ('Square150x150Logo.png', 150), ('Square284x284Logo.png', 284),
    ('Square310x310Logo.png', 310), ('StoreLogo.png', 50)
]:
    master.resize((sz, sz), Image.Resampling.LANCZOS).save(f'src-tauri/icons/{tile}')

# Windows multi-size .ico
ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
master.save('src-tauri/icons/icon.ico', format='ICO', sizes=ico_sizes)

print('All neon M icons generated successfully!')
