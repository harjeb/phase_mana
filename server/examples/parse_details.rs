//! Temporary diagnostic: dump unsupported parse items (with source text) for named cards.
//! cargo run --release --example parse_details -- DB "Card A" "Card B" ...
use engine::database::CardDatabase;
use engine::game::coverage::{build_parse_details_for_face, card_face_gaps, ParsedItem};
use std::{fs, io::Read, path::PathBuf};

fn print_item(item: &ParsedItem, depth: usize) {
    if item.supported && item.children.iter().all(|c| c.is_fully_supported()) {
        return;
    }
    let pad = "  ".repeat(depth);
    println!(
        "{pad}[{:?}] {} supported={} src={:?}",
        item.category, item.label, item.supported, item.source_text
    );
    for (k, v) in &item.details {
        println!("{pad}   {k}={v}");
    }
    for child in &item.children {
        print_item(child, depth + 1);
    }
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let path = PathBuf::from(&args[0]);
    let names = &args[1..];
    let mut head = [0u8; 16];
    let n = fs::File::open(&path)?.read(&mut head)?;
    let raw = head[..n].starts_with(b"{\"meta\"");
    let started = std::time::Instant::now();
    let db = if raw {
        CardDatabase::from_mtgjson(&path)?
    } else {
        CardDatabase::from_export(&path)?
    };
    eprintln!("loaded {} rules in {:?}", db.card_count(), started.elapsed());
    for name in names {
        println!("\n########## {name}");
        match db.get_face_by_name(name) {
            None => println!("  NOT IN DATABASE"),
            Some(face) => {
                println!("  gaps: {:?}", card_face_gaps(face));
                for item in build_parse_details_for_face(face) {
                    print_item(&item, 1);
                }
            }
        }
    }
    Ok(())
}

fn main() {
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(|| {
            if let Err(e) = run() {
                eprintln!("{e}");
                std::process::exit(1);
            }
        })
        .unwrap()
        .join()
        .unwrap();
}
