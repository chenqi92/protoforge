fn main() {
    tauri_build::build();

    // On Windows, copy FFmpeg DLLs to the output directory so the executable can find them at runtime
    #[cfg(target_os = "windows")]
    {
        if let Ok(ffmpeg_dir) = std::env::var("FFMPEG_DIR") {
            let bin_dir = std::path::Path::new(&ffmpeg_dir).join("bin");
            if bin_dir.exists() {
                let out_dir = std::env::var("OUT_DIR").unwrap();
                // OUT_DIR is like target/debug/build/<pkg>/out — walk up to target/debug/
                let target_dir = std::path::Path::new(&out_dir)
                    .ancestors()
                    .find(|p| p.ends_with("debug") || p.ends_with("release"))
                    .map(|p| p.to_path_buf());

                if let Some(target_dir) = target_dir {
                    for entry in std::fs::read_dir(&bin_dir).unwrap() {
                        let entry = entry.unwrap();
                        let path = entry.path();
                        if path.extension().and_then(|e| e.to_str()) == Some("dll") {
                            let dest = target_dir.join(path.file_name().unwrap());
                            if !dest.exists() {
                                println!("cargo:warning=Copying FFmpeg DLL: {}", path.display());
                                std::fs::copy(&path, &dest).ok();
                            }
                        }
                    }
                }
            }
        }
    }
}
